import { DisplayableDataObject, Record } from '@/data/client/models';
import { ChatContextType, MessageType } from '@/contexts/chat-context';
import { ConfigContextType } from '@/contexts/config-context';
import { prompts } from '@/data/ai/prompts';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';

interface ParseWithAIDirectCallParams {
    record: Record;
    chatContext: ChatContextType;
    configContext: ConfigContextType | null;
    updateRecordFromText: (text: string, record: Record, allowNewRecord: boolean) => Promise<Record | null>;
    updateParseProgress: (record: Record, inProgress: boolean, progress: number, progressOf: number, metadata: any, error: any) => void;
    sourceImages: DisplayableDataObject[];
    parseAIProvider: string;
    parseModelName: string;
}

export async function parseWithAIDirectCall({
    record,
    chatContext,
    configContext,
    updateRecordFromText,
    updateParseProgress,
    sourceImages,
    parseAIProvider,
    parseModelName
}: ParseWithAIDirectCallParams): Promise<Record> {
    return new Promise(async (resolve, reject) => {
        try {
            // Prepare the prompt
            const prompt = record.transcription
                ? prompts.recordParseMultimodalTranscription({ record, config: configContext })
                : prompts.recordParseMultimodal({ record, config: configContext });

            let content = '';
            let chunkIndex = 0;
            let error: any = null;
            updateParseProgress(record, true, 0, 0, null, null);

            await chatContext.aiDirectCall([
                {
                    id: nanoid(),
                    role: 'user',
                    createdAt: new Date(),
                    type: MessageType.Parse,
                    content: prompt,
                    experimental_attachments: sourceImages,
                }
            ], async (resultMessage, result) => {
                if (result.finishReason !== 'error') {
                    if (result.finishReason === 'length') {
                        toast.error('Too many findings for one record. Try uploading attachments one per record');
                    }
                    resultMessage.recordRef = record;
                    resultMessage.recordSaved = true;
                    await record.updateChecksumLastParsed();
                    updateParseProgress(record, false, chunkIndex, 1, null, null);
                    const updatedRecord = await updateRecordFromText(resultMessage.content, record, false);
                    if (updatedRecord) {
                        resolve(updatedRecord);
                    } else {
                        reject(new Error('Failed to update record'));
                    }
                } else {
                    error = result;
                    updateParseProgress(record, false, chunkIndex, 1, null, error);
                    reject(result);
                }
            }, parseAIProvider, parseModelName);
        } catch (err) {
            updateParseProgress(record, false, 0, 0, null, err);
            reject(err);
        }
    });
} 