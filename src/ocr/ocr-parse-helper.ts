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
    let chunkIndex = 0;
    return new Promise(async (resolve, reject) => {
        try {
            // Prepare the prompt
            const prompt = record.transcription
                ? prompts.recordParseMultimodalTranscription({ record, config: configContext })
                : prompts.recordParseMultimodal({ record, config: configContext });

            let content = '';
            let error: any = null;
            updateParseProgress(record, true, 0, 0, null, null);

            const stream = chatContext.aiDirectCallStream([
                {
                    id: nanoid(),
                    role: 'user',
                    createdAt: new Date(),
                    type: MessageType.Parse,
                    content: prompt,
                    experimental_attachments: sourceImages,
                }
            ], undefined, parseAIProvider, parseModelName);

            for await (const delta of stream) {
                content += delta;
                chunkIndex++;
                updateParseProgress(record, true, chunkIndex, 0, { textDelta: delta, accumulated: content }, null);
            }

            // After streaming is done
            updateParseProgress(record, false, chunkIndex, 0, { accumulated: content }, null);
            await record.updateChecksumLastParsed();
            const updatedRecord = await updateRecordFromText(content, record, false);
            if (updatedRecord) {
                resolve(updatedRecord);
            } else {
                reject(new Error('Failed to update record'));
            }
        } catch (err) {
            updateParseProgress(record, false, chunkIndex, 0, null, err);
            reject(err);
        }
    });
} 