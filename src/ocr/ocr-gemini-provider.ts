import { DataLoadingStatus, DisplayableDataObject, EncryptedAttachment, Folder, Record } from '@/data/client/models';
import { findCodeBlocks } from "@/lib/utils";
import { AIResultEventType, ChatContextType, MessageType, MessageVisibility } from '@/contexts/chat-context';
import { ConfigContextType } from '@/contexts/config-context';
import { FolderContextType } from '@/contexts/folder-context';
import { RecordContextType } from '@/contexts/record-context';
import { prompts } from '@/data/ai/prompts';
import { toast } from 'sonner';

export async function parse(record: Record, chatContext: ChatContextType, configContext: ConfigContextType | null, folderContext: FolderContextType | null, updateRecordFromText: (text: string, record: Record, allowNewRecord: boolean) => Record|null, updateParseProgress: (record: Record, inProgress: boolean, error: any) => void, sourceImages: DisplayableDataObject[]): Promise<AIResultEventType> {
    const parseAIProvider = await configContext?.getServerConfig('llmProviderParse') as string;
    const geminiApiKey = await configContext?.getServerConfig('geminiApiKey') as string;
    const parseModelName = await configContext?.getServerConfig('llmModelParse') as string;

    if (!geminiApiKey) {
        toast.error('Please configure Gemini API key in settings');
        return Promise.reject('Gemini API key not configured');
    }

    return new Promise(async (resolve, reject) => {
        try {


            // Prepare the prompt
            const prompt = record.transcription ? 
                prompts.recordParseMultimodalTranscription({ record, config: configContext }) :
                prompts.recordParseMultimodal({ record, config: configContext });

            // Send to chat context with images
            chatContext.sendMessage({
                message: {
                    role: 'user',
                    createdAt: new Date(),
                    type: MessageType.Parse,
                    content: prompt,
                    experimental_attachments: sourceImages
                },
                onResult: async (resultMessage, result) => {
                    if (result.finishReason !== 'error') {
                        if (result.finishReason === 'length') {
                            toast.error('Too many findings for one record. Try uploading attachments one per record')
                        }

                        resultMessage.recordRef = record;
                        updateParseProgress(record, false, null);
                        resultMessage.recordSaved = true;
                        await record.updateChecksumLastParsed();
                        updateRecordFromText(resultMessage.content, record, false);
                        resolve(result);
                    } else {
                        reject(result);
                    }
                },
                providerName: parseAIProvider,
                modelName: parseModelName
            });
        } catch (error) {
            console.error('Error in Gemini OCR:', error);
            reject(error);
        }
    });
} 