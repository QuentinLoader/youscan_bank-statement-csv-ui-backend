/**
 * YouScan 2.0
 * Parser registry
 */

import { bankStatementPlugin } from "../plugins/bankStatement/bankStatement.plugin.js";

const parsers = [bankStatementPlugin];

export function getParserByKey(parserKey) {
  return parsers.find((parser) => parser.key === parserKey) || null;
}

export function getParserForClassification(classification) {
  return parsers.find((parser) => parser.canHandle(classification)) || null;
}