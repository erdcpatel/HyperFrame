import React, { useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import { Copy, Check } from 'lucide-react';

interface Props {
  code: string;
  language?: string;
  className?: string;
}

export const SyntaxHighlighter: React.FC<Props> = ({ code, language = 'sql', className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const highlighted = React.useMemo(() => {
    const grammar = Prism.languages[language] || Prism.languages.sql;
    return Prism.highlight(code || '', grammar, language);
  }, [code, language]);

  return (
    <div className={`relative group rounded-lg bg-[#0e1422] border border-[#24324f] overflow-hidden ${className}`}>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-[#1b253b] hover:bg-[#253352] text-slate-400 hover:text-slate-200 opacity-80 hover:opacity-100 transition-opacity flex items-center gap-1 text-xs z-10"
        title="Copy code"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
};
