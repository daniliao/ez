import { DataLoadingStatus, DisplayableDataObject, EncryptedAttachment, Folder, Record } from '@/data/client/models';
import { findCodeBlocks } from "@/lib/utils";
import { AIResultEventType, ChatContextType, MessageType, MessageVisibility } from '@/contexts/chat-context';
import { ConfigContextType } from '@/contexts/config-context';
import { FolderContextType } from '@/contexts/folder-context';
import { getRecordExtra } from '@/contexts/record-context';
import { prompts } from '@/data/ai/prompts';
import { toast } from 'sonner';

const AVERAGE_TOKENS_PER_PAGE = 1400;

export async function parse(record: Record, chatContext: ChatContextType, configContext: ConfigContextType | null, folderContext: FolderContextType | null, updateRecordFromText: (text: string, record: Record, allowNewRecord: boolean) => Promise<Record|null>, updateParseProgress: (record: Record, inProgress: boolean, progress: number, progressOf: number, page: number, pages: number, metadata: any, error: any) => Promise<Record>, sourceImages: DisplayableDataObject[]): Promise<Record> {
    const parseAIProvider = await configContext?.getServerConfig('llmProviderParse') as string;
    const parseModelName = await configContext?.getServerConfig('llmModelParse') as string;

    const parseProgressInPages = parseInt(await getRecordExtra(record, 'Document parsed pages') as string || '0');
    let parseProgressInTokens = parseProgressInPages * AVERAGE_TOKENS_PER_PAGE;
    let totalProgressOfInTokens = sourceImages.length * AVERAGE_TOKENS_PER_PAGE;

    return new Promise(async (resolve, reject) => {
        try {
            // Prepare the prompt

            let page = parseProgressInPages + 1;
            let pages = sourceImages.length;
            
            let recordText = '';

            record = await updateParseProgress(record, true, 0, 0, 0, 0, null, null); // set in progress


            for (let pageAcc = 1; pageAcc <= page; pageAcc++) {
                const pageText = await getRecordExtra(record, 'Page ' + pageAcc + ' content') as string; /// accumulate the page content - as we're saving it page by page
                if (pageText) {
                    recordText += pageText;
                }
            }
            
            
            for (const image of sourceImages.slice(parseProgressInPages)) {
                let pageText = '';
                const prompt = prompts.recordParseSinglePage({ record, config: configContext, page }); // TODO: add transcription if exists

                let pageLengthInTokens = 0;
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
                    totalProgressOfInTokens -= AVERAGE_TOKENS_PER_PAGE;
                    totalProgressOfInTokens += pageLengthInTokens // adjust the estimaged
                }, parseAIProvider, parseModelName);
                // parsing page by page

                let chunkIndex = 0;
                for await (const delta of stream) { 
                    pageText += delta;
                    record = await updateParseProgress(record, true, parseProgressInTokens, totalProgressOfInTokens, page, pages, { textDelta: delta }, null);
                    chunkIndex++;
                    pageLengthInTokens += 1;
                    parseProgressInTokens += 1;

                    if (parseProgressInTokens > totalProgressOfInTokens) {
                        totalProgressOfInTokens = parseProgressInTokens;
                    }
                }

                // Clean up pageText before saving
                pageText = pageText.replace(/```[a-zA-Z]*\n?|```/g, '');
                recordText += pageText + '\n\r\n\r';
                record = await updateParseProgress(record, true, parseProgressInTokens, totalProgressOfInTokens, page, pages, { pageDelta: pageText, recordText: recordText }, null); //saves the record

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
            totalProgressOfInTokens *= 1.6; // we estimate the metadata to be twice as long as the text
            for await (const delta of metadataStream) {
                parseProgressInTokens += 1;
                if (parseProgressInTokens > totalProgressOfInTokens) {
                    totalProgressOfInTokens = parseProgressInTokens;
                }
                metaDataJson += delta;
                record = await updateParseProgress(record as Record, true, parseProgressInTokens, totalProgressOfInTokens, pages, pages, null, null);
            }

            metaDataJson = metaDataJson.replace(/```[a-zA-Z]*\n?|```/g, '');

            const fullTextToProcess = '```json\n' + metaDataJson + '\n```\n\r\n\r' + '```markdown\n' + recordText + '\n```';
            await record.updateChecksumLastParsed();

            let updatedRecord = await updateRecordFromText(fullTextToProcess, record, false);
            updatedRecord = await updateParseProgress(updatedRecord as Record, false, totalProgressOfInTokens, totalProgressOfInTokens, pages, pages, { recordText: fullTextToProcess }, null);



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