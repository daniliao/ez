import { useContext } from 'react';
import { RecordContext } from '@/contexts/record-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import Markdown from 'react-markdown';

export default function ParsingProgressDialog() {
  const recordContext = useContext(RecordContext);
  const open = recordContext?.parsingDialogOpen;
  const setOpen = recordContext?.setParsingDialogOpen;
  const recordId = recordContext?.parsingDialogRecordId;
  const parsingProgress = recordId ? recordContext?.parsingProgressByRecordId[recordId] : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Parsing Progress</DialogTitle>
        </DialogHeader>
        {parsingProgress ? (
          <>
            <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              Page: {parsingProgress.progress} / {parsingProgress.progressOf}
            </div>
            <div className="mb-2 text-xs text-zinc-400">
              Last updated: {parsingProgress.history.length > 0 ? new Date(parsingProgress.history[parsingProgress.history.length-1].timestamp).toLocaleString() : '-'}
            </div>
            <div className="mb-2 text-xs font-mono bg-zinc-100 dark:bg-zinc-900 p-2 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
              {parsingProgress.textDelta || '*No streaming text yet*'}
            </div>
          </>
        ) : (
          <div className="text-xs text-zinc-400">No parsing progress yet.</div>
        )}
      </DialogContent>
    </Dialog>
  );
} 