# Your Drive as Database

This utility script can be used to download and transform Google Drive files

# Assumptions
You have separates folders for Docs, Spreadsheets and Images

# How to use

1. Create a secrets.json file or setup keyless authentication (For github CI)
2. Create .env file with the following variables:
```
IMAGES_FOLDER_ID="<GOOGLE_DRIVE_FOLDER_ID>"
ARTICLES_FOLDER_ID="<GOOGLE_DRIVE_FOLDER_ID>"
DATA_FOLDER_ID="<GOOGLE_DRIVE_FOLDER_ID>"
```
3. Install dependencies:
```
npm install
```
or
```
yarn
```
4. Install ts-node
```
npm install -g ts-node
```
5. Run code:

```typescript
import YourDriveAsDB, { ArticleContent } from "."

function parseDocument(
  doc: ArticleContent
) {
  // Your parsing logic goes here
}

async function start() {
  const driveProcessor = await YourDriveAsDB();
  const articles = driveProcessor.processArticles((metadata, article) => ({
    metadata: {
      name: metadata.name,
      id: metadata.description
    },
    article: parseDocument(article)
  }));
}

start();

```

