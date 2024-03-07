import dotenv from "dotenv";
import processGoogleDrive from "./src/process";

dotenv.config();

export default processGoogleDrive;

export type { ArticleContent, SchemaContent } from "./src/google-adapter";
