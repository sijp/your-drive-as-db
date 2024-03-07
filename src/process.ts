import GoogleAdapter, {
  ArticleContent,
  ArticleMetaData,
  SchemaMetaData,
  SchemaContent,
  CategoryMetaData,
  MIMETYPES
} from "./google-adapter";

import lodash from "lodash";

interface Table {
  schema: SchemaMetaData;
  content: SchemaContent;
}

interface Article {
  schema: ArticleMetaData;
  content: ArticleContent;
}

type DataConvertorFn<ReturnType> = (
  schema: SchemaMetaData,
  record: string[],
  columns: string[]
) => ReturnType;

type ArticleConvertorFn<ReturnType> = (
  metadata: ArticleMetaData,
  article: ArticleContent
) => ReturnType;

type MenuEntryConvertorFn<ReturnType> = (
  entry: CategoryMetaData | ArticleMetaData
) => ReturnType;

interface MenuItem<MenuData> {
  entry: MenuData;
  children?: MenuItem<MenuData>[];
  parent: MenuData | undefined;
}

function processTable<ReturnType>(
  table: Table,
  convertor: DataConvertorFn<ReturnType>
) {
  const [columns, ...data] = table.content;
  return data.map((record) => convertor(table.schema, record, columns));
}

function processSingleArticle<ReturnType>(
  article: Article,
  convertor: ArticleConvertorFn<ReturnType>
) {
  return convertor(article.schema, article.content);
}

function processArticles(articles: Article[]) {
  return <ReturnType>(convertor: ArticleConvertorFn<ReturnType>) =>
    articles.map((article) => processSingleArticle(article, convertor));
}

function processDataBase(database: Table[]) {
  return <ReturnType>(convertor: DataConvertorFn<ReturnType>) =>
    database.map((table) => ({
      metadata: table.schema,
      data: processTable(table, convertor)
    }));
}

function processArticlesMenu(categories: CategoryMetaData) {
  return <ReturnType>(convertor: MenuEntryConvertorFn<ReturnType>) => {
    const recursiveMap = (
      entry: CategoryMetaData | ArticleMetaData,
      parent?: ReturnType
    ): MenuItem<ReturnType> => {
      const convertedEntry = convertor(entry);
      return "children" in entry
        ? {
            children: lodash.compact(
              entry.children.map((child) =>
                child.mimeType === MIMETYPES.ARTICLE ||
                (child.mimeType === MIMETYPES.FOLDER && "children" in child)
                  ? recursiveMap(child, convertedEntry)
                  : null
              )
            ),
            entry: convertedEntry,
            parent
          }
        : { entry: convertedEntry, parent };
    };

    return recursiveMap(categories, undefined);
  };
}

export default async function processGoogleDrive() {
  const {
    getImages,
    getArticles,
    getArticleInfo,
    download,
    getDB,
    getEmbeddedImages
  } = GoogleAdapter();

  const images = await getImages("Getting images:");
  const imageStreams = await Promise.all(
    images.map((file) => download(file, `\tDownloading Image ${file.name}`))
  );

  const articlesInfo = await getArticleInfo("Getting Article Info:");
  const articles = await getArticles(articlesInfo);
  const articleFiles = await Promise.all(
    articles.map(async (file) => {
      const content = await download(
        file,
        `\tDownloading Article ${file.name}`
      );
      const embeddedImages = getEmbeddedImages(content);
      return {
        schema: file,
        content,
        embeddedImages
      };
    })
  );

  if (process.env["NODE_ENV"] !== "test") {
    console.log("\tGetting embedded images:");
  }
  const embeddedImageStreams = await Promise.all(
    articleFiles.flatMap(({ embeddedImages }) =>
      embeddedImages.map((image) =>
        image.uri !== null && image.uri !== undefined
          ? download(
              {
                id: image.id,
                name: image.id,
                uri: image.uri,
                description: "",
                mimeType: MIMETYPES.IMAGE
              },
              `\t\tDownloading Embedded Image ${image.id}`
            )
          : null
      )
    )
  );

  const schemas = await getDB("Getting Database");
  const database = await Promise.all(
    schemas.map(async (schema) => {
      const content = await download(
        schema,
        `\tDownloading schema file ${schema.name}`
      );
      return {
        schema,
        content
      };
    })
  );

  return {
    getImageStreams: () => lodash.compact(imageStreams),
    getEmbeddedImageStreams: () => lodash.compact(embeddedImageStreams),
    processArticles: processArticles(articleFiles),
    processDataBase: processDataBase(database),
    processArticlesMenu: processArticlesMenu(articlesInfo)
  };
}
