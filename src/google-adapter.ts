import { docs_v1, google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import lodash from "lodash";
import { Readable } from "stream";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { readFileToStream, writeFileFromStream } from "./data-folder";
import path from "path";
import https from "https";

interface FileData {
  id: string;
  name: string;
  mimeType: string;
  description: string;
}

interface ArticleFileData extends FileData {
  mimeType: MIMETYPES.ARTICLE;
}

interface FolderFileData extends FileData {
  mimeType: MIMETYPES.FOLDER;
}

interface ImageFileData extends FileData {
  mimeType: MIMETYPES.IMAGE | MIMETYPES.IMAGE_PNG;
}

interface EmbeddedImageFileData extends FileData {
  mimeType: MIMETYPES.IMAGE | MIMETYPES.IMAGE_PNG;
  uri: string;
}

interface SchemaFileData extends FileData {
  mimeType: MIMETYPES.SCHEMA;
}

type SupportedFileData =
  | ArticleFileData
  | SchemaFileData
  | FolderFileData
  | FolderFileDataTree
  | ImageFileData
  | EmbeddedImageFileData;

interface FolderFileDataTree extends FolderFileData {
  children: SupportedFileData[];
}

export enum MIMETYPES {
  FOLDER = "application/vnd.google-apps.folder",
  ARTICLE = "application/vnd.google-apps.document",
  SCHEMA = "application/vnd.google-apps.spreadsheet",
  IMAGE = "image/jpeg",
  IMAGE_PNG = "image/png"
}

export type ArticleContent = docs_v1.Schema$Document;

export type ArticleMetaData = ArticleFileData;
export type SchemaMetaData = SchemaFileData;
export type CategoryMetaData = FolderFileDataTree;
export type SchemaContent = string[][];

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly"
];

function authenticate() {
  const CI = process.env["CI"];
  if (CI !== "true") {
    return new GoogleAuth({
      keyFile: "./secrets.json",
      scopes: SCOPES
    });
  }
  // const keys = JSON.parse(keysEnvVar);
  // const client = auth.fromJSON(keys);
  const client = new GoogleAuth({
    scopes: SCOPES
  });
  return client;
}
async function cache<T>(name: string, cb: () => T, msg?: string | undefined) {
  try {
    const fileName = `.cache/${name}`;
    if (msg) process.stdout.write(`${msg}...`);
    if (existsSync(fileName) && statSync(fileName).isFile()) {
      if (msg) process.stdout.write("CACHE HIT\n");
      return JSON.parse(await readFile(fileName, { encoding: "utf8" })) as T;
    }
    process.stdout.write("CACHE MISS\n");

    const data = await cb();
    const folder = path.dirname(fileName);
    if (
      existsSync(folder) === false ||
      statSync(folder).isDirectory() === false
    ) {
      await mkdir(folder, { recursive: true });
    }

    writeFile(fileName, JSON.stringify(data));
    return data;
  } catch (e) {
    console.log(e);
    throw e;
  }
}

async function cacheStream(
  name: string,
  cb: () => Promise<Readable>,
  msg?: string | undefined
) {
  const fileName = `.cache/${name}`;
  if (msg) process.stdout.write(`${msg}...`);
  if (existsSync(fileName) && statSync(fileName).isFile()) {
    if (msg) process.stdout.write("CACHE HIT\n");
    return readFileToStream(fileName);
  }

  process.stdout.write("CACHE MISS\n");
  const stream = await cb();
  const folder = path.dirname(fileName);
  if (
    existsSync(folder) === false ||
    statSync(folder).isDirectory() === false
  ) {
    await mkdir(folder, { recursive: true });
  }

  await writeFileFromStream(fileName, stream);
  return readFileToStream(fileName) as Promise<Readable>;
}

export default function GoogleAdapter() {
  const client = authenticate();
  const drive = google.drive({ version: "v3", auth: client });
  const docs = google.docs({ version: "v1", auth: client });
  const sheets = google.sheets({ version: "v4", auth: client });

  if (!process.env["ARTICLES_FOLDER_ID"])
    throw "Missing env ARTICLES_FOLDER_ID";
  if (!process.env["IMAGES_FOLDER_ID"]) throw "Missing env IMAGES_FOLDER_ID";
  if (!process.env["DATA_FOLDER_ID"]) throw "Missing env DATA_FOLDER_ID";

  const articleRoot: FolderFileData = {
    id: process.env["ARTICLES_FOLDER_ID"],
    description: "root articles folder",
    name: "root",
    mimeType: MIMETYPES.FOLDER
  };

  const imageRoot: FolderFileData = {
    id: process.env["IMAGES_FOLDER_ID"],
    description: "root images folder",
    name: "root",
    mimeType: MIMETYPES.FOLDER
  };

  const dataRoot: FolderFileData = {
    id: process.env["DATA_FOLDER_ID"],
    description: "root data folder",
    name: "root",
    mimeType: MIMETYPES.FOLDER
  };

  const listFiles: (id: string) => Promise<SupportedFileData[]> = async (
    id: string
  ) => {
    try {
      let res = await drive.files.list({
        q: `'${id}' in parents`,
        pageSize: 5,
        fields: "nextPageToken, files(id, name, mimeType, description)"
      });
      if (!res.data.files?.length) {
        throw new Error("Bad or empty image directory");
      }

      const files = [res.data.files];
      while (res.data.nextPageToken) {
        const pageToken = res.data.nextPageToken;
        res = await drive.files.list({
          q: `'${id}' in parents`,
          pageSize: 5,
          fields: "nextPageToken, files(id, name, mimeType, description)",
          pageToken
        });
        files.push(res.data.files!);
      }

      return lodash.flatten(files) as unknown as SupportedFileData[];
    } catch (error) {
      throw new Error(`API Error ${error}`);
    }
  };

  const recListFiles: (
    folder: FolderFileData
  ) => Promise<FolderFileDataTree> = async (folder: FolderFileData) => {
    return {
      ...folder,
      children: await Promise.all(
        (
          await listFiles(folder.id)
        ).map((file) =>
          file.mimeType === MIMETYPES.FOLDER ? recListFiles(file) : file
        )
      )
    };
  };

  async function download(
    src: ImageFileData,
    msg?: string | undefined
  ): Promise<{ id: string; stream: Readable }>;
  async function download(
    src: EmbeddedImageFileData,
    msg?: string | undefined
  ): Promise<{ id: string; stream: Readable }>;
  async function download(
    src: ArticleFileData,
    msg?: string | undefined
  ): Promise<ArticleContent>;
  async function download(
    src: SchemaFileData,
    msg?: string | undefined
  ): Promise<SchemaContent>;
  async function download(src: SupportedFileData, msg?: string | undefined) {
    let result;
    switch (src.mimeType) {
      case MIMETYPES.ARTICLE:
        result = await cache(
          `downloads/articles/${src.id}`,
          () => docs.documents.get({ documentId: src.id }),
          msg
        );
        return result.data;
      case MIMETYPES.IMAGE:
      case MIMETYPES.IMAGE_PNG:
        result = await cacheStream(
          `downloads/images/${src.id}`,
          async () =>
            "uri" in src
              ? new Promise((resolve) => {
                  https.get(src.uri, (response) => resolve(response));
                })
              : (
                  await drive.files.get(
                    { fileId: src.id, alt: "media" },
                    { responseType: "stream" }
                  )
                ).data,
          msg
        );
        return { id: src.name, stream: result };
      case MIMETYPES.SCHEMA:
        result = await cache(
          `downloads/database/${src.id}`,
          () =>
            sheets.spreadsheets.values.get({
              spreadsheetId: src.id,
              range: "A:ZZ"
            }),
          msg
        );

        return result.data.values;
      default:
        throw "Unsupported File type";
    }
  }

  async function getImages() {
    return listFiles(imageRoot.id) as Promise<ImageFileData[]>;
  }

  function getEmbeddedImages(article: ArticleContent) {
    const inlineImagesUris = article.inlineObjects
      ? Object.entries(article.inlineObjects).map(([objectId, props]) => ({
          id: objectId,
          uri: props.inlineObjectProperties?.embeddedObject?.imageProperties
            ?.contentUri
        }))
      : [];

    const positionedImageUris = article.positionedObjects
      ? Object.entries(article.positionedObjects).map(([objectId, props]) => ({
          id: objectId,
          uri: props.positionedObjectProperties?.embeddedObject?.imageProperties
            ?.contentUri
        }))
      : [];

    return [...inlineImagesUris, ...positionedImageUris];
  }

  async function getArticles(articlesInfo: FolderFileDataTree) {
    const getLeaves: (
      folderTree: FolderFileDataTree
    ) => Array<SupportedFileData> = (folderTree: FolderFileDataTree) =>
      lodash.flatten(
        folderTree.children.map((file) =>
          file.mimeType === MIMETYPES.FOLDER && "children" in file
            ? getLeaves(file)
            : file
        )
      );

    return lodash.compact(
      getLeaves(articlesInfo).map((file) =>
        file.mimeType === MIMETYPES.ARTICLE ? file : null
      )
    );
  }

  async function getArticleInfo() {
    return recListFiles(articleRoot);
  }

  async function getDB() {
    return listFiles(dataRoot.id) as Promise<SchemaFileData[]>;
  }

  return {
    download,
    getArticles,
    getArticleInfo: (msg?: string) =>
      cache("getArticleInfo", getArticleInfo, msg),
    getImages: (msg?: string) => cache("getImages", getImages, msg),
    getEmbeddedImages,
    getDB: (msg?: string) => cache("getDB", getDB, msg)
  };
}
