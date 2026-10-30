import React, { useState, useRef, useEffect } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { Play, FileCode, AlertCircle, Columns, Sparkles, Command, RotateCw } from 'lucide-react';
import { ColumnWeather, EngineType, HyperQuery, QueryWaterfall } from '../../types';
import { runQuery } from '../../services/api';

interface Props {
  datasetId: string;
  engine: EngineType;
  columns?: ColumnWeather[];
  onWaterfallUpdate: (w: QueryWaterfall, queryStr: string, totalRows: number, returnedRows: number) => void;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET',
  'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN',
  'CROSS JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'NOT IN',
  'LIKE', 'ILIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'DESC', 'ASC',
  'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT',
  'EXPLAIN', 'EXPLAIN ANALYZE', 'PRAGMA'
];

const SQL_FUNCTIONS = [
  { label: 'COUNT(*)', insertText: 'COUNT(*)', detail: 'Count all matching rows' },
  { label: 'COUNT(col)', insertText: 'COUNT(${1:column})', detail: 'Count non-null values' },
  { label: 'SUM(col)', insertText: 'SUM(${1:column})', detail: 'Sum of numeric column' },
  { label: 'AVG(col)', insertText: 'AVG(${1:column})', detail: 'Average of numeric column' },
  { label: 'MIN(col)', insertText: 'MIN(${1:column})', detail: 'Minimum value' },
  { label: 'MAX(col)', insertText: 'MAX(${1:column})', detail: 'Maximum value' },
  { label: 'ROUND(col, 2)', insertText: 'ROUND(${1:column}, ${2:2})', detail: 'Round to decimal places' },
  { label: 'COALESCE(a, b)', insertText: 'COALESCE(${1:col}, ${2:\'\'})', detail: 'Return first non-null' },
  { label: 'APPROX_COUNT_DISTINCT(col)', insertText: 'APPROX_COUNT_DISTINCT(${1:column})', detail: 'HyperLogLog approx distinct' },
  { label: 'ROW_NUMBER() OVER (...)', insertText: 'ROW_NUMBER() OVER (PARTITION BY ${1:col} ORDER BY ${2:col})', detail: 'Window row number' }
];

export const QueryEditor: React.FC<Props> = ({
  datasetId,
  engine,
  columns = [],
  onWaterfallUpdate,
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const providerRef = useRef<any>(null);

  const defaultSql = `SELECT 
    symbol, 
    desk, 
    COUNT(*) AS total_trades, 
    ROUND(SUM(notional), 2) AS total_notional,
    ROUND(AVG(execution_latency_ms), 3) AS avg_latency_ms
FROM :dataset
WHERE status = 'FILLED'
GROUP BY symbol, desk
ORDER BY total_notional DESC
LIMIT 50;`;

  const [rawSql, setRawSql] = useState(defaultSql);
  const [data, setData] = useState<any[]>([]);
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    let interval: any = null;
    if (loading) {
      const start = Date.now();
      setElapsedMs(0);
      interval = setInterval(() => {
        setElapsedMs(Date.now() - start);
      }, 100);
    } else {
      setElapsedMs(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  // Keep a stable ref for handleRun so Monaco command binding doesn't capture stale closures
  const handleRunRef = useRef<() => void>(() => {});

  const handleRun = async () => {
    const queryToRun = editorRef.current ? editorRef.current.getValue() : rawSql;
    if (!queryToRun.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const q: HyperQuery = {
        dataset: datasetId,
        engine,
        raw_sql: queryToRun,
        limit: 100,
      };

      const tStart = performance.now();
      const res = await runQuery(q);
      const tRender = performance.now() - tStart;

      setData(res.data || []);
      setResultColumns(res.columns);
      onWaterfallUpdate(
        { ...res.waterfall, client_render_ms: Math.round(tRender) },
        res.query_string,
        res.total_matching_rows,
        res.returned_rows
      );
    } catch (err: any) {
      setError(err.message || 'Query execution failed');
    } finally {
      setLoading(false);
    }
  };

  handleRunRef.current = handleRun;

  // Setup Monaco completion provider with live Column Weather IntelliSense
  const setupCompletionProvider = (monaco: Monaco) => {
    if (providerRef.current) {
      providerRef.current.dispose();
    }

    providerRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '(', ',', ':'],
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: any[] = [
          // 1. Table name placeholder
          {
            label: ':dataset',
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: ':dataset',
            detail: `Active dataset: ${datasetId}`,
            documentation: 'HyperFrame table alias resolved automatically to the dataset parquet path.',
            range,
          },
          // 2. Active Schema Columns with rich weather metadata
          ...columns.map((c) => ({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: c.name,
            detail: `${c.dtype} · (nulls: ${c.null_percentage}%)`,
            documentation: {
              value: [
                `**Column:** \`${c.name}\``,
                `**Type:** \`${c.dtype}\``,
                `**Approx Unique:** ~${c.approx_unique.toLocaleString()}`,
                `**Nulls:** ${c.null_percentage}% (${c.null_count.toLocaleString()} rows)`,
                c.min_value ? `**Min:** \`${c.min_value}\`` : '',
                c.max_value ? `**Max:** \`${c.max_value}\`` : '',
              ].filter(Boolean).join('\n\n'),
            },
            range,
          })),
          // 3. SQL Keywords
          ...SQL_KEYWORDS.map((kw) => ({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
          })),
          // 4. Common Functions & Snippets
          ...SQL_FUNCTIONS.map((fn) => ({
            label: fn.label,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: fn.detail,
            range,
          })),
        ];

        return { suggestions };
      },
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    setupCompletionProvider(monaco);

    // Bind Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux) to run query
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunRef.current();
    });

    // Custom dark background for HyperFrame studio aesthetic
    monaco.editor.defineTheme('hyperframe-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '60a5fa', fontStyle: 'bold' },
        { token: 'operator.sql', foreground: '38bdf8' },
        { token: 'string.sql', foreground: '34d399' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#090d16',
        'editor.foreground': '#cbd5e1',
        'editor.lineHighlightBackground': '#111827',
        'editorCursor.foreground': '#38bdf8',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#94a3b8',
        'editor.selectionBackground': '#1e3a8a80',
      },
    });
    monaco.editor.setTheme('hyperframe-dark');
  };

  // Re-register provider when dataset columns change
  useEffect(() => {
    if (monacoRef.current) {
      setupCompletionProvider(monacoRef.current);
    }
    return () => {
      if (providerRef.current) {
        providerRef.current.dispose();
      }
    };
  }, [columns, datasetId]);

  const insertColumnAtCursor = (colName: string) => {
    if (editorRef.current) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      editor.executeEdits('chips', [
        {
          range: selection,
          text: colName,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
    } else {
      setRawSql((prev) => `${prev} ${colName}`);
    }
  };

  const loadTemplate = (sql: string) => {
    setRawSql(sql);
    if (editorRef.current) {
      editorRef.current.setValue(sql);
      editorRef.current.focus();
    }
    setError(null);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] select-none">
      {/* Templates & Run Toolbar */}
      <div className="h-11 border-b border-[#1f2b45] bg-[#0e1424] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-semibold">Templates:</span>
          <button
            onClick={() =>
              loadTemplate(`SELECT symbol, COUNT(*) AS trades, SUM(notional) AS total_notional
FROM :dataset
GROUP BY symbol
ORDER BY total_notional DESC
LIMIT 10;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Top 10 Symbols
          </button>
          <button
            onClick={() =>
              loadTemplate(`SELECT * FROM :dataset
WHERE notional > 500000 AND status = 'FILLED'
ORDER BY notional DESC
LIMIT 100;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Large Filled Trades
          </button>
          <button
            onClick={() =>
              loadTemplate(`SELECT desk, side, COUNT(*) AS count, AVG(price) AS avg_price
FROM :dataset
GROUP BY desk, side
ORDER BY count DESC;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Desk & Side Pivot
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 hidden sm:flex items-center gap-1 font-mono">
            <Command className="w-3 h-3 text-slate-500" /> + Enter to Run
          </span>
          <button
            onClick={handleRun}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md shadow-emerald-950/40 transition-all active:scale-95 disabled:opacity-75 disabled:cursor-wait"
          >
            {loading ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Running ({(elapsedMs / 1000).toFixed(1)}s)...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Run Query</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor & Output Splitter */}
      <div className="flex-1 grid grid-rows-2 min-h-0">
        {/* Monaco SQL Editor Area */}
        <div className="border-b border-[#1f2b45] flex flex-col min-h-0 bg-[#090d16]">
          {/* Quick-Click Column Chips Bar */}
          {columns.length > 0 && (
            <div className="px-3 py-1.5 border-b border-[#1a2339] bg-[#0c1220] flex items-center gap-1.5 overflow-x-auto text-[11px] text-slate-400 shrink-0">
              <span className="flex items-center gap-1 font-semibold text-slate-400 shrink-0">
                <Columns className="w-3 h-3 text-blue-400" />
                Columns:
              </span>
              {columns.map((c) => (
                <button
                  key={c.name}
                  onClick={() => insertColumnAtCursor(c.name)}
                  className="px-2 py-0.5 rounded bg-[#162035] hover:bg-blue-600/30 hover:text-blue-300 border border-[#24324f] text-slate-300 font-mono text-[10px] shrink-0 transition-colors"
                  title={`Insert '${c.name}' (${c.dtype}) into editor`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Monaco React Editor */}
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              defaultLanguage="sql"
              defaultValue={rawSql}
              theme="hyperframe-dark"
              onMount={handleEditorDidMount}
              onChange={(val) => setRawSql(val || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                tabCompletion: 'on',
                lineDecorationsWidth: 4,
                lineNumbersMinChars: 3,
                formatOnType: true,
                renderLineHighlight: 'all',
              }}
            />
          </div>
        </div>

        {/* Results Area */}
        <div className="flex flex-col min-h-0 bg-[#0b0f19] p-3 overflow-hidden">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {!error && data.length > 0 && (
            <div className="flex-1 overflow-auto rounded-lg border border-[#1f2b45] bg-[#0e1424]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#141b2c] border-b border-[#24324f] text-slate-300 sticky top-0">
                  <tr>
                    {resultColumns.map((c) => (
                      <th key={c} className="py-2 px-3 font-semibold text-slate-300">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#172238]">
                  {data.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#121929]">
                      {resultColumns.map((c) => (
                        <td key={c} className="py-1.5 px-3 text-slate-300 truncate max-w-xs">
                          {String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!error && data.length === 0 && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
              <FileCode className="w-8 h-8 text-slate-600 mb-2" />
              <span>Execute SQL (Cmd+Enter) to see real-time query results</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
