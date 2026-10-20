import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline, type MarkdownList } from "@/lib/markdown";

/**
 * Renders Markdown as React elements and nothing else. The text may be agent
 * or model output, so it is never treated as HTML: raw tags show as escaped
 * text, and links only exist for http(s) and mailto (see lib/markdown).
 * No hooks and no server-only imports, so server and client components share it.
 */

function renderInlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "br":
        return <br key={i} />;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "strong":
        return <strong key={i}>{renderInlines(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInlines(node.children)}</em>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInlines(node.children)}
          </a>
        );
    }
  });
}

function renderList(list: MarkdownList, key: number): ReactNode {
  const items = list.items.map((item, i) => (
    <li key={i}>
      {renderInlines(item.inlines)}
      {item.children && renderList(item.children, 0)}
    </li>
  ));
  return list.ordered ? (
    <ol key={key} start={list.start !== 1 ? list.start : undefined}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as const;
      return <Tag key={key}>{renderInlines(block.inlines)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{renderInlines(block.inlines)}</p>;
    case "list":
      return renderList(block, key);
    case "table": {
      const style = (i: number) => (block.align[i] ? { textAlign: block.align[i]! } : undefined);
      return (
        <div key={key} className="lx-md-scroll">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} style={style(i)}>
                    {renderInlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} style={style(i)}>
                      {renderInlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{block.children.map(renderBlock)}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} />;
  }
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `lx-md ${className}` : "lx-md"}>{parseMarkdown(text).map(renderBlock)}</div>;
}
