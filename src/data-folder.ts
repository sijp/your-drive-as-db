import { mkdir } from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import path from "path";

import { Readable } from "stream";

export async function createDataFolder() {
  await mkdir("./data/images", { recursive: true });
  await mkdir("./data/articles", { recursive: true });
}

export async function readFileToStream(src: string) {
  return createReadStream(src);
}

export async function writeFileFromStream(target: string, stream: Readable) {
  const dest = createWriteStream(target);

  return new Promise((res, rej) => {
    stream
      .on("end", () => {
        res(true);
      })
      .on("error", (error) => {
        rej(error);
      })
      .pipe(dest);
  });
}

export function getFilePath(relPath: string) {
  return path.join("./data/", relPath);
}
