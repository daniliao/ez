import { DataLoadingStatus, DisplayableDataObject, EncryptedAttachment, Folder, Record } from '@/data/client/models';
import { findCodeBlocks } from "@/lib/utils";
import { AIResultEventType, ChatContextType, MessageType, MessageVisibility } from '@/contexts/chat-context';
import { ConfigContextType } from '@/contexts/config-context';
import { FolderContextType } from '@/contexts/folder-context';
import { getRecordExtra } from '@/contexts/record-context';
import { prompts } from '@/data/ai/prompts';
import { toast } from 'sonner';

const AVERAGE_TOKENS_PER_PAGE = 1200;

export async function parse(record: Record, chatContext: ChatContextType, configContext: ConfigContextType | null, folderContext: FolderContextType | null, updateRecordFromText: (text: string, record: Record, allowNewRecord: boolean) => Promise<Record|null>, updateParseProgress: (record: Record, inProgress: boolean, progress: number, progressOf: number, metadata: any, error: any) => Promise<Record>, sourceImages: DisplayableDataObject[]): Promise<Record> {
    const parseAIProvider = await configContext?.getServerConfig('llmProviderParse') as string;
    const parseModelName = await configContext?.getServerConfig('llmModelParse') as string;

    const parseProgress = parseInt(await getRecordExtra(record, 'Document parsed pages') as string || '0');

    return new Promise(async (resolve, reject) => {
        try {
            // Prepare the prompt

            let page = parseProgress + 1;
            
            let recordText = '';

            record = await updateParseProgress(record, true, 0, 0, null, null); // set in progress


            for (let pageAcc = 1; pageAcc <= page; pageAcc++) {
                const pageText = await getRecordExtra(record, 'Page ' + pageAcc + ' content') as string; /// accumulate the page content - as we're saving it page by page
                if (pageText) {
                    recordText += pageText;
                }
            }
            
            
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

                let chunkIndex = 0;
                for await (const delta of stream) { 
                    pageText += delta;
                    record = await updateParseProgress(record, true, page * AVERAGE_TOKENS_PER_PAGE + chunkIndex, sourceImages.length * AVERAGE_TOKENS_PER_PAGE, { textDelta: delta }, null);
                    chunkIndex++;
                }

                // Clean up pageText before saving
                pageText = pageText.replace(/```[a-zA-Z]*\n?|```/g, '');
                recordText += pageText + '\n\r\n\r';
                record = await updateParseProgress(record, true, page * AVERAGE_TOKENS_PER_PAGE, sourceImages.length * AVERAGE_TOKENS_PER_PAGE, { pageDelta: pageText, recordText: recordText }, null); //saves the record

                page++;
            }


            const metadataStream = chatContext.aiDirectCallStream([
                {
                    id: 'metadata',
                    role: 'user',
                    content: prompts.recordParseMetadata({ record, config: configContext, page }),
                }
            ]);

            let metaDataJson = '';
            for await (const delta of metadataStream) {
                metaDataJson += delta;
                record = await updateParseProgress(record as Record, true, 0, 0, null, null);
            }

            metaDataJson = metaDataJson.replace(/```[a-zA-Z]*\n?|```/g, '');

            const fullTextToProcess = '```json\n' + metaDataJson + '\n```\n\r\n\r' + '```markdown\n' + recordText + '\n```';
            await record.updateChecksumLastParsed();

            let updatedRecord = await updateRecordFromText(fullTextToProcess, record, false);
            updatedRecord = await updateParseProgress(updatedRecord as Record, false, sourceImages.length * AVERAGE_TOKENS_PER_PAGE, sourceImages.length * AVERAGE_TOKENS_PER_PAGE, { recordText: fullTextToProcess }, null);



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