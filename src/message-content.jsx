import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
};

export default function MessageContent({ children }) {
  return <div className="message-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={components}>{children}</Markdown></div>;
}
