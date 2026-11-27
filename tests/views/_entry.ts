import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Entry-point detection for the View as guards, through the AST (never a line regex), so a leading comment, a blank line
 * or single quotes can't let a "use server" file skip a check.
 */
function directives(statements: readonly ts.Statement[]): string[] {
  const out: string[] = [];
  for (const st of statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) out.push(st.expression.text);
    else break;
  }
  return out;
}

const parse = (file: string, src?: string) => ts.createSourceFile(file, src ?? readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** The file's leading directive prologue says "use server". */
export function isUseServerFile(file: string, src?: string): boolean {
  return directives(parse(file, src).statements).includes("use server");
}

/** Every function body under the file that opens with its own "use server" (an inline server action). */
export function nestedUseServer(file: string, src?: string): string[] {
  const sf = parse(file, src);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)) {
      if (directives(node.body.statements).includes("use server")) hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export const isRouteFile = (file: string) => /[\\/]route\.ts$/.test(file);
export const isEntryFile = (file: string) => isRouteFile(file) || isUseServerFile(file);
