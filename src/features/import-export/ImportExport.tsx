import { useState } from 'react';
import { supabase } from '../../db/client';
import { pageAll } from '../../db/queries';
import { useToast } from '../../ui/Toast';
import { parseCardsCsv, parseQuestionsJson } from './parse';
import { buildBackup, describeImport, importCards, importQuestions, type ImportProgress, type TableSpec } from './transfer';

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

const fetchTable = (spec: TableSpec) =>
  pageAll<unknown>((a, b) => {
    let q = supabase.from(spec.name).select('*');
    if (spec.ownedOnly) q = q.not('owner_id', 'is', null);
    for (const col of spec.order) q = q.order(col);
    return q.range(a, b);
  });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ImportExport() {
  const toast = useToast();
  const [report, setReport] = useState('');

  async function runImport(
    noun: string, rejected: string[], total: number,
    run: (resume?: ImportProgress) => Promise<ImportProgress>, resume?: ImportProgress,
  ): Promise<void> {
    const p = await run(resume);
    setReport(describeImport(noun, p, rejected));
    if (p.error) toast.show(`Import stopped after ${p.processed} of ${total} saved: ${p.error}`, () => void runImport(noun, rejected, total, run, p));
  }

  async function doCards(file: File) {
    const { rows, rejected } = parseCardsCsv(await file.text());
    const owner = await userId();
    await runImport('cards', rejected.map((x) => `line ${x.line}: ${x.reason}`), rows.length, (r) => importCards(supabase, owner, rows, r));
  }

  async function doQuestions(file: File) {
    const { rows, rejected } = parseQuestionsJson(await file.text());
    const owner = await userId();
    await runImport('questions', rejected.map((x) => `item ${x.index}: ${x.reason}`), rows.length, (r) => importQuestions(supabase, owner, rows, r));
  }

  async function exportAll() {
    try {
      const out = await buildBackup(fetchTable);
      const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `usmle-prep-backup-${Date.now()}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 0); // revoking synchronously can cancel the download on older Safari
    } catch (e) {
      toast.show(`Export failed: ${errMsg(e)}`, () => void exportAll());
    }
  }

  const pick = (fn: (f: File) => Promise<void>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (f) fn(f).catch((err) => toast.show(`Import failed: ${errMsg(err)}`));
  };

  return (
    <div className="card">
      <h2>Import</h2>
      <p>Cards: Anki "Notes in Plain Text" export or a two-column CSV (front, back).</p>
      <input type="file" accept=".csv,.tsv,.txt" onChange={pick(doCards)} />
      <p>Questions: a JSON array of <code>{'{ stem, choices[], correct, explanation }'}</code>.</p>
      <input type="file" accept=".json" onChange={pick(doQuestions)} />
      {report && <pre>{report}</pre>}
      <h2>Export</h2>
      <button onClick={() => void exportAll()}>Download my backup (JSON)</button>
    </div>
  );
}
