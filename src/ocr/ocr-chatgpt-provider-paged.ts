import { DataLoadingStatus, DisplayableDataObject, EncryptedAttachment, Folder, Record } from '@/data/client/models';
import { findCodeBlocks } from "@/lib/utils";
import { AIResultEventType, ChatContextType, MessageType, MessageVisibility } from '@/contexts/chat-context';
import { ConfigContextType } from '@/contexts/config-context';
import { FolderContextType } from '@/contexts/folder-context';
import { getRecordExtra } from '@/contexts/record-context';
import { prompts } from '@/data/ai/prompts';
import { toast } from 'sonner';

export async function parse(record: Record, chatContext: ChatContextType, configContext: ConfigContextType | null, folderContext: FolderContextType | null, updateRecordFromText: (text: string, record: Record, allowNewRecord: boolean) => Promise<Record|null>, updateParseProgress: (record: Record, inProgress: boolean, progress: number, progressOf: number, metadata: any, error: any) => Promise<void>, sourceImages: DisplayableDataObject[]): Promise<Record> {
    const parseAIProvider = await configContext?.getServerConfig('llmProviderParse') as string;
    const parseModelName = await configContext?.getServerConfig('llmModelParse') as string;

    const parseProgress = parseInt(await getRecordExtra(record, 'Document parsed pages') as string || '0');

    return new Promise(async (resolve, reject) => {
        try {
            // Prepare the prompt

            let page = parseProgress + 1;
            let recordText = '';
            for (const image of sourceImages.slice(parseProgress)) {
                let pageText = '';
                const prompt = prompts.recordParseSinglePage({ record, config: configContext, page }); // TODO: add transcription if exists

                const stream = chatContext.aiDirectCallStream([
                    {
                        id: 'page-' + page,
                        role: 'user',
                        content: prompt,
                        type: MessageType.Parse,
                        createdAt: new Date(),
                        experimental_attachments: [image]                         
                    }
                ], async (resultMessage, result) => {
                }, parseAIProvider, parseModelName);
                // parsing page by page

                for await (const delta of stream) { 
                    recordText += delta;
                    pageText += delta;
                    await updateParseProgress(record, true, page, sourceImages.length, { textDelta: delta }, null);
                }

                

                await updateParseProgress(record, true, page, sourceImages.length, { pageDelta: pageText }, null);

                page++;
            }
            await record.updateChecksumLastParsed();


            const updatedRecord = await updateRecordFromText(recordText, record, false);
            if (updatedRecord) {
                resolve(updatedRecord);
            } else {
                reject(new Error('Failed to update record'));
            }


        } catch (error) {
            console.error('Error in ChatGPT paged OCR:', error);
            reject(error);
        }
    });
} 