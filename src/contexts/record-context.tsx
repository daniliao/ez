import '@enhances/with-resolvers';
import React, { createContext, useState, useEffect, useContext, PropsWithChildren, useRef } from 'react';
import { EncryptedAttachmentDTO, EncryptedAttachmentDTOEncSettings, RecordDTO } from '@/data/dto';
import { RecordApiClient } from '@/data/client/record-api-client';
import { ApiEncryptionConfig } from '@/data/client/base-api-client';
import { DataLoadingStatus, DisplayableDataObject, EncryptedAttachment, Folder, Record, PostParseCallback, RegisteredOperations, AVERAGE_PAGE_TOKENS } from '@/data/client/models';
import { ConfigContext, ConfigContextType } from '@/contexts/config-context';
import { toast } from 'sonner';
import { sort } from 'fast-sort';
import { EncryptedAttachmentApiClient } from '@/data/client/encrypted-attachment-api-client';
import { DatabaseContext } from './db-context';
import { ChatContext, CreateMessageEx, MessageType, MessageVisibility, OnResultCallback } from './chat-context';
import { convertDataContentToBase64String } from "ai";
import { convert } from '@/lib/pdf2js'
import { pdfjs } from 'react-pdf'
import { prompts } from "@/data/ai/prompts";
import { parse as chatgptParseRecord } from '@/ocr/ocr-chatgpt-provider';
import { parse as tesseractParseRecord } from '@/ocr/ocr-tesseract-provider';
import { parse as geminiParseRecord } from '@/ocr/ocr-gemini-provider';
import { FolderContext } from './folder-context';
import { findCodeBlocks, getCurrentTS, getErrorMessage, getTS } from '@/lib/utils';
import { parse } from 'path';
import { CreateMessage, Message } from 'ai/react';
import { DTOEncryptionFilter, EncryptionUtils, sha256 } from '@/lib/crypto';
import { jsonrepair } from 'jsonrepair'
import { GPTTokens } from 'gpt-tokens'
import JSZip, { file } from 'jszip'
import { saveAs } from 'file-saver';
import filenamify from 'filenamify/browser';
import showdown from 'showdown'
import { auditLog } from '@/lib/audit';
import { diff, addedDiff, deletedDiff, updatedDiff, detailedDiff } from 'deep-object-diff';
import { AuditContext } from './audit-context';
import { SaaSContext } from './saas-context';
import { nanoid } from 'nanoid';
import { parse as chatgptPagedParseRecord } from '@/ocr/ocr-llm-provider-paged';


// Add the helper function before the parseQueueInProgress variable
const discoverEventDate = (record: Record): string => {

  // Check if eventDate is NaN and use createdAt as fallback
  if (record.eventDate && isNaN(Date.parse(record.eventDate))) {
    return record.createdAt;
  }

  if (record.eventDate) {
    return record.eventDate;
  }

  if (record.json && Array.isArray(record.json)) {
    // Try to find any date field in the JSON data
    const dateFields = ['test_date', 'admission_date', 'visit_date', 'procedure_date', 'examination_date', 'date'] as const;
    
    for (const field of dateFields) {
      const item = record.json.find(item => {
        const value = item as { [key: string]: unknown };
        return value[field] !== undefined;
      });
      
      if (item) {
        const value = item as { [key: string]: unknown };
        const foundDate = value[field];
        if (foundDate && (typeof foundDate === 'string' || foundDate instanceof Date)) {
          const parsedDate = getTS(new Date(foundDate));
          if (parsedDate) {
            return parsedDate;
          }
        }
      }
    }
  }

  // If no specific date found, use createdAt as fallback
  return record.createdAt;
};



export const getRecordExtra = async (record: Record, type: string) => {
  return record.extra?.find(p => p.type === type)?.value;
}

let parseQueueInProgress = false;
let parseQueue:Record[] = []
let parseQueueLength = 0;

// Parsing progress state: recordId -> { progress, progressOf, metadata, textDelta, pageDelta, history: [] }
// We'll use a React state for this, so move it into the provider below.

export type FilterTag = {
  tag: string; 
  freq: number; 
}

export enum AttachmentFormat {
    dataUrl = 'dataUrl',
    blobUrl = 'blobUrl',
    blob = 'blob'
  }

export type RecordContextType = {
    records: Record[];
    filteredRecords: Record[];
    recordEditMode: boolean;
    parseQueueLength: number;
    setRecordEditMode: (editMode: boolean) => void;
    recordDialogOpen: boolean;
    setRecordDialogOpen: (open: boolean) => void;
    currentRecord: Record | null; 
    updateRecord: (record: Record) => Promise<Record>;
    deleteRecord: (record: Record) => Promise<boolean>;
    listRecords: (forFolder: Folder) => Promise<Record[]>;
    setCurrentRecord: (record: Record | null) => void; // new method
    loaderStatus: DataLoadingStatus;
    operationStatus: DataLoadingStatus;
    setOperationStatus: (status: DataLoadingStatus) => void;

    updateRecordFromText: (text: string, record?: Record | null, allowNewRecord?: boolean, extra?: { type: string, value: string }[]) => Promise<Record | null>;
    getAttachmentData: (attachmentDTO: EncryptedAttachmentDTO, type: AttachmentFormat) => Promise<string|Blob>;
    downloadAttachment: (attachment: EncryptedAttachmentDTO, useCache: boolean) => void;
    convertAttachmentsToImages: (record: Record, statusUpdates: boolean) => Promise<DisplayableDataObject[]>;
    extraToRecord: (type: string, promptText: string, record: Record) => void;
    parseRecord: (record: Record, postParseCallback?: PostParseCallback) => void;
    sendRecordToChat: (record: Record, forceRefresh: boolean) => void;
    sendAllRecordsToChat: (customMessage: CreateMessageEx | null, providerName?: string, modelName?: string, onResult?: OnResultCallback) => void;

    processParseQueue: () => void;
    filterAvailableTags: FilterTag[];
    filterSelectedTags: string[];
    setFilterSelectedTags: (selectedTags: string[]) => void;
    filterToggleTag: (tag: string) => void;

    filtersOpen: boolean;
    setFiltersOpen: (open: boolean) => void;

    sortBy: string;
    setSortBy: (sortBy: string) => void;

    getTagsTimeline: () => { year: string, freq: number }[];

    exportRecords: () => void;
    importRecords: (zipFileInput: ArrayBuffer) => void;
    setRecordExtra: (record: Record, type: string, value: string) => Promise<Record>;
    removeRecordExtra: (record: Record, type: string) => Promise<void>;
    translateRecord: (record: Record, language?: string) => Promise<Record>;
    operationProgressByRecordId: {
      [recordId: string]: {
        operationName: string;
        progress: number;
        progressOf: number;
        page: number;
        pages: number;
        metadata: any;
        textDelta: string;
        pageDelta: string;
        recordText?: string;
        history: { operationName: string; progress: number; progressOf: number; page: number; pages: number; metadata: any; textDelta: string; pageDelta: string; recordText?: string; timestamp: number }[];
      }
    };
    parsingDialogOpen: boolean;
    setParsingDialogOpen: (open: boolean) => void;
    parsingDialogRecordId: string | null;
    setParsingDialogRecordId: (id: string | null) => void;
}

export const RecordContext = createContext<RecordContextType | null>(null);

export const RecordContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
    const [recordEditMode, setRecordEditMode] = useState<boolean>(false);
    const [recordDialogOpen, setRecordDialogOpen] = useState<boolean>(false);
    const [records, setRecords] = useState<Record[]>([]);
    const [filteredRecords, setFilteredRecords] = useState<Record[]>([]);
    const [loaderStatus, setLoaderStatus] = useState<DataLoadingStatus>(DataLoadingStatus.Idle);
    const [operationStatus, setOperationStatus] = useState<DataLoadingStatus>(DataLoadingStatus.Idle);
    const [currentRecord, setCurrentRecord] = useState<Record | null>(null); // new state
    const [filterAvailableTags, setFilterAvailableTags] = useState<FilterTag[]>([]);
    const [filterSelectedTags, setFilterSelectedTags] = useState<string[]>([]);
    const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
    const [sortBy, setSortBy] = useState<string>('eventDate desc');
    const [operationProgressByRecordId, setOperationProgressByRecordId] = useState<{
      [recordId: string]: {
        operationName: string;
        page: number;
        pages: number;
        progress: number;
        progressOf: number;
        metadata: any;
        textDelta: string;
        pageDelta: string;
        recordText?: string;
        history: { operationName: string; progress: number; progressOf: number; page: number; pages: number; metadata: any; textDelta: string; pageDelta: string; recordText?: string; timestamp: number }[];
      }
    }>({});
    const [parsingDialogOpen, setParsingDialogOpen] = useState(false);
    const [parsingDialogRecordId, setParsingDialogRecordId] = useState<string | null>(null);
    
    
    useEffect(() => { // filter records when tags change
      console.log('Selected tags', filterSelectedTags);

      setFilteredRecords(records.filter(record => { // using AND operand (every), if we want to have OR then we should do (some)
        if (!filterSelectedTags || filterSelectedTags.length === 0) {
          return true;  
        } else {
          return record.tags ? filterSelectedTags.every(tag => record.tags && record.tags.includes(tag)) : false;
        }
      }));
    }, [filterSelectedTags, records]);

    
    const config = useContext(ConfigContext);
    const dbContext = useContext(DatabaseContext)
    const saasContext = useContext(SaaSContext);
    const chatContext = useContext(ChatContext);
    const folderContext = useContext(FolderContext)
    const auditContext = useContext(AuditContext);

    const cache = async () => {
      return await caches.open('recordContext');      
    }

    const filterToggleTag = (tag: string) => {
      if (filterSelectedTags.includes(tag)) {
        setFilterSelectedTags(prev => prev.filter(t => t !== tag));
      } else {
        setFilterSelectedTags(prev => [...prev, tag]);
      }
    }

    const getTagsTimeline = (): { year: string, freq: number }[] => {
        const uniqueYears: { [year: string]: number } = {};

        records.forEach(record => {
          if (record.tags) {
            record.tags.forEach(tag => {
              const year = parseInt(tag);
              if (!isNaN(year) && year >= 1900) {
                if (uniqueYears[tag]) {
                  uniqueYears[tag]++;
                } else {
                  uniqueYears[tag] = 1;
                }
              }
            });
          }
        });

        const timeline = Object.entries(uniqueYears).map(([year, freq]) => ({
          year,
          freq
        }));

        return timeline;
    }

    const updateRecord = async (record: Record): Promise<Record> => {
        try {
            setOperationStatus(DataLoadingStatus.Loading);
            const client = await setupApiClient(config);

            if (record.json && record.json.length > 0) {
              if (record.json[0].title && !record.title) {
                record.title = record.json[0].title;
              }
              if (record.json[0].summary && !record.description) {
                record.description = record.json[0].summary;
              }
              if (!record.tags || record.tags.length === 0) {
                const uniqueTags = record.json.reduce((tags: string[], item: any) => {
                  if (item.tags && Array.isArray(item.tags)) {
                    const newTags = item.tags.filter((tag: string) => !tags.includes(tag));
                    return [...tags, ...newTags];
                  }
                  return tags;
                }, []);
                record.tags = uniqueTags;
              }

            // Check for language in extra field and add corresponding tag
            const languageExtra = record.extra?.find(e => e.type === 'Translation language')?.value;
            if (languageExtra && typeof languageExtra === 'string') {
                const languageTag = `Language: ${languageExtra}`;
                if (!record.tags) {
                    record.tags = [languageTag];
                } else if (!record.tags.includes(languageTag)) {
                    record.tags.push(languageTag);
                }
              }

            }

            // Use the helper function to discover event date
            record.eventDate = discoverEventDate(record);

            const recordDTO = record.toDTO(); // DTOs are common ground between client and server
            const response = await client.put(recordDTO);
            const newRecord = typeof record?.id  === 'undefined'

            if (response.status !== 200) {
                console.error('Error adding folder record:', response.message);
                toast.error('Error adding folder record');
                setOperationStatus(DataLoadingStatus.Error);
                return record;
            } else {
              const updatedRecord = new Record({ ...record, id: response.data.id } as Record);
              const prevRecord = records.find(r => r.id === record.id);
              setRecords(prevRecords => 
                    newRecord ? [...prevRecords, updatedRecord] :
                    prevRecords.map(pr => pr.id === updatedRecord.id ?  updatedRecord : pr)
                )

                if (dbContext) auditContext?.record({ eventName: prevRecord ? 'updateRecord' : 'createRecord', encryptedDiff: prevRecord ? JSON.stringify(detailedDiff(prevRecord, updatedRecord)) : '',  recordLocator: JSON.stringify([{ recordIds: [updatedRecord.id]}])});

                //chatContext.setRecordsLoaded(false); // reload context next time - TODO we can reload it but we need time framed throthling #97
                setOperationStatus(DataLoadingStatus.Success);
                return updatedRecord;
            }
        } catch (error) {
            console.error('Error adding folder record:', error);
            toast.error('Error adding folder record');
            setOperationStatus(DataLoadingStatus.Error);
            return record;
        }
    };

    const updateRecordFromText = async (text: string, record: Record | null = null, allowNewRecord = true, extra?: { type: string, value: string }[]): Promise<Record|null> => {
        let recordMarkdown = "";
        try {
            if (text.indexOf('```json') > -1) {
                const codeBlocks = findCodeBlocks(text.trimEnd().endsWith('```') ? text : text + '```', false);
                let recordJSON = [];
                if (codeBlocks.blocks.length > 0) {
                    for (const block of codeBlocks.blocks) {
                        if (block.syntax === 'json') {
                            const jsonObject = JSON.parse(jsonrepair(block.code));
                            if (Array.isArray(jsonObject)) {
                                for (const recordItem of jsonObject) {
                                    recordJSON.push(recordItem);
                                }
                            } else recordJSON.push(jsonObject);
                        }

                        if (block.syntax === 'markdown') {
                            recordMarkdown += block.code;
                        }
                    }
                    if (recordJSON.length > 0) {
                        const hasError = recordJSON.find(item => item.error);
                        if (hasError) {
                            toast.error('Uploaded file is not valid health data. Record will be deleted: ' + hasError.error);
                            if (record) {
                                await deleteRecord(record);
                                auditContext.record({ eventName: 'invalidRecord',  recordLocator: JSON.stringify([{ recordIds: [record.id]}])});
                            }
                            return null;
                        }
                    }
                    const discoveredEventDate = getTS(new Date(recordJSON.length > 0 ? recordJSON.find(item => item.test_date)?.test_date || recordJSON.find(item => item.admission_date)?.admission_date : record?.createdAt));
                    const discoveredType = recordJSON.length > 0 ? recordJSON.map(item => item.subtype ? item.subtype : item.type).join(", ") : 'note';
                    if (record) {
                        const recordDTO = record.toDTO();
                        const updatedRecord = Record.fromDTO({
                            ...recordDTO,
                            json: JSON.stringify(recordJSON),
                            text: recordMarkdown || null,
                            type: discoveredType,
                            eventDate: discoveredEventDate,
                            extra: extra ? JSON.stringify([...(record.extra || []), ...extra]) : recordDTO.extra
                        });
                        return await updateRecord(updatedRecord);
                    } else {
                        if (allowNewRecord && folderContext?.currentFolder?.id) { // create new folder Record
                            const newRecord = Record.fromDTO({
                                folderId: folderContext?.currentFolder?.id,
                                type: discoveredType,
                                createdAt: getCurrentTS(),
                                updatedAt: getCurrentTS(),
                                json: JSON.stringify(recordJSON),
                                text: recordMarkdown || null,
                                eventDate: discoveredEventDate,
                                extra: extra ? JSON.stringify(extra) : '[]',
                                attachments: '[]',
                                checksum: '',
                                checksumLastParsed: ''
                            });
                            return await updateRecord(newRecord);
                        }
                    }
                    console.log('JSON repr: ', recordJSON);
                } 
            } else { // create new folder Record for just plain text
                if (allowNewRecord && folderContext?.currentFolder?.id) { // create new folder Record
                    return new Promise<Record | null>((resolve) => {
                        chatContext.aiDirectCall([{ role: 'user', content: prompts.generateRecordMetaData({ record: null, config }, text), id: nanoid() }], (result) => {
                            console.log('Meta data: ', result.content);
                            let metaData = {} as any;
                            const codeBlocks = findCodeBlocks(result.content.endsWith('```') ? result.content : result.content + '```', false);
                            if (codeBlocks.blocks.length > 0) {
                                for (const block of codeBlocks.blocks) {
                                    if (block.syntax === 'json') {
                                        const jsonObject = JSON.parse(jsonrepair(block.code));
                                        metaData = jsonObject;
                                    }
                                }
                            }          
                            
                            try {
                                const recordDTO: RecordDTO = {
                                    folderId: folderContext?.currentFolder?.id as number,
                                    type: 'note',
                                    createdAt: getCurrentTS(),
                                    updatedAt: getCurrentTS(),
                                    eventDate: getCurrentTS(),
                                    json: JSON.stringify(metaData),
                                    text: recordMarkdown || text,
                                    attachments: '[]',
                                    checksum: '',
                                    checksumLastParsed: '',
                                    title: metaData.title || null,
                                    description: metaData.summary || null,
                                    tags: JSON.stringify(metaData.tags || []),
                                    extra: extra ? JSON.stringify(extra) : JSON.stringify(metaData.extra || []),
                                    transcription: null
                                };
                                const newRecord = Record.fromDTO(recordDTO);
                                updateRecord(newRecord).then((updatedRecord) => {
                                    resolve(updatedRecord);
                                }).catch((error) => {
                                    toast.error('Error creating record from text.');
                                    setOperationStatus(DataLoadingStatus.Error);
                                    resolve(null);
                                });
                            } catch (error) {
                                toast.error('Error creating record from text.');
                                setOperationStatus(DataLoadingStatus.Error);
                                resolve(null);
                            }
                        }, 'chatgpt', 'gpt-4o'); // using small model for summary
                    });
                }
            }
            return null;
        } catch (error) {
            toast.error('Error processing text: ' + getErrorMessage(error));
            setOperationStatus(DataLoadingStatus.Error);
            return null;
        }
    }

    const deleteRecord = async (record: Record) => {
        const prClient = await setupApiClient(config);
        const attClient = await setupAttachmentsApiClient(config);

        // Check for preserved attachments
        const preservedAttachmentsExtra = record.extra?.find(e => e.type === 'Preserved attachments')?.value;
        const preservedAttachmentIds = typeof preservedAttachmentsExtra === 'string' ? preservedAttachmentsExtra.split(',').map(id => id.trim()) : [];
        
        if(record.attachments.length > 0) {
          for(const attachment of record.attachments) {
            // Skip deletion if attachment is preserved
            if (preservedAttachmentIds.includes(attachment.id?.toString() || '')) {
              console.log('Skipping deletion of preserved attachment:', attachment.id);
              continue;
            }
            const result = await attClient.delete(attachment.toDTO());
            if (result.status !== 200) {
                toast.error('Error removing attachment: ' + attachment.displayName)
            }
          }
        }
        const result = await prClient.delete(record)
        if(result.status !== 200) {
            toast.error('Error removing folder record: ' + result.message)
            return Promise.resolve(false);
        } else {
            toast.success('Folder record removed successfully!')
            setRecords(prvRecords => prvRecords.filter((pr) => pr.id !== record.id));    
            if (dbContext) auditContext.record({ eventName: 'deleteRecord',  recordLocator: JSON.stringify([{ recordIds: [record.id]}])});

            //chatContext.setRecordsLoaded(false); // reload context next time        
            return Promise.resolve(true);
        }
    };

    const listRecords = async (forFolder: Folder) => {
        try {
            const client = await setupApiClient(config);
            setLoaderStatus(DataLoadingStatus.Loading);
            const response = await client.get(forFolder.toDTO());
            const fetchedRecords = response.map((recordDTO: RecordDTO) => Record.fromDTO(recordDTO));

            const fetchedTags = fetchedRecords.reduce((tags: FilterTag[], record: Record) => {
              const uniqueTags = record.tags && record.tags.length > 0 ? record.tags : []; //.filter(tag => !tags.some(t => t.tag === tag)) : [];
              uniqueTags.forEach(tag => {
              const existingTag = tags.find(t => t.tag === tag);
              if (existingTag) {
                existingTag.freq++;
              } else {
                tags.push({ tag, freq: 1 });
              }
              });
              return tags;
            }, []);

            setFilterAvailableTags(fetchedTags);
            setRecords(fetchedRecords);
            setLoaderStatus(DataLoadingStatus.Success);
            if (dbContext) auditContext.record({ eventName: 'listRecords', recordLocator: JSON.stringify([{folderId: forFolder.id, recordIds: [fetchedRecords.map(r=>r.id)]}])});
            return fetchedRecords;
        } catch (error) {
            setLoaderStatus(DataLoadingStatus.Error);
            toast.error('Error listing folder records');            
            return Promise.reject(error);
        }    
    };

    const setupApiClient = async (config: ConfigContextType | null) => {
        const masterKey = dbContext?.masterKey;
        const encryptionConfig: ApiEncryptionConfig = {
            secretKey: masterKey,
            useEncryption: true
        };
        const client = new RecordApiClient('', dbContext, saasContext, encryptionConfig);
        return client;
    }

    const setupAttachmentsApiClient = async (config: ConfigContextType | null) => {
        const masterKey = dbContext?.masterKey;
        const encryptionConfig: ApiEncryptionConfig = {
            secretKey: masterKey,
            useEncryption: true
        };
        const client = new EncryptedAttachmentApiClient('', dbContext, saasContext, encryptionConfig);
        return client;
    }

      const getAttachmentData = async(attachmentDTO: EncryptedAttachmentDTO, type: AttachmentFormat, useCache = true): Promise<string|Blob> => {
        const cacheStorage = await cache();
        const cacheKey = `${attachmentDTO.storageKey}-${attachmentDTO.id}-${type}`;
        const attachmentDataUrl = await cacheStorage.match(cacheKey);

        if (attachmentDataUrl && useCache) {
          console.log('Attachment loaded from cache ', attachmentDTO)
          return attachmentDataUrl.text();
        }
    
        console.log('Download attachment', attachmentDTO);
    
        const client = await setupAttachmentsApiClient(config);
        const arrayBufferData = await client.get(attachmentDTO);    
    
        if (type === AttachmentFormat.blobUrl) {
          const blob = new Blob([arrayBufferData], { type: attachmentDTO.mimeType + ";charset=utf-8" });
          const url = URL.createObjectURL(blob);
          if(useCache) cacheStorage.put(cacheKey, new Response(url))
          return url;
        } else if (type === AttachmentFormat.blob) {
          const blob = new Blob([arrayBufferData]);
//          if(useCache) cacheStorage.put(cacheKey, new Response(blob, { headers: { 'Content-Type': attachmentDTO.mimeType as string } })) we're skipping cache for BLOBs as there was some issue with encoding for that case
          return blob;
        } else {
          const url = 'data:' + attachmentDTO.mimeType +';base64,' + convertDataContentToBase64String(arrayBufferData);
          if(useCache) cacheStorage.put(cacheKey, new Response(url))
          return url;
        }
      }
    
      const downloadAttachment = async (attachment: EncryptedAttachmentDTO, useCache = true) => {
        try {
          const url = await getAttachmentData(attachment, AttachmentFormat.blobUrl, useCache) as string;
          window.open(url);    
        } catch (error) {
          toast.error('Error downloading attachment ' + error);
        }
      };
    
      const calcChecksum = async (record: Record): Promise<string> => {
        const attachmentsHash = await sha256(record.attachments.map(ea => ea.storageKey).join('-'), 'attachments')
        const cacheKey = `record-${record.id}-${attachmentsHash}-${dbContext?.databaseHashId}`;

        return cacheKey;
      }

      const convertAttachmentsToImages = async (record: Record, statusUpdates: boolean = true): Promise<DisplayableDataObject[]> => {

        if (!record.attachments || record.attachments.length == 0) return [];

        const attachments = []
        const cacheStorage = await cache();
        const cacheKey = await calcChecksum(record);
        const cachedAttachments = await cacheStorage.match(cacheKey);

        if (cachedAttachments) {
          const deserializedAttachments = await cachedAttachments.json() as DisplayableDataObject[];
          console.log(`Attachment images loaded from cache for ${record.id} - pages: ` + deserializedAttachments.length + ' (' + cacheKey + ')');
          return deserializedAttachments;
        }

        for(const ea of record.attachments){
    
          try {
            if (ea.mimeType === 'application/pdf') {
              if (statusUpdates) toast.info('Downloading file ' + ea.displayName);
              const pdfBase64Content = await getAttachmentData(ea.toDTO(), AttachmentFormat.dataUrl) as string; // convert to images otherwise it's not supported by vercel ai sdk
              if (statusUpdates) toast.info('Converting file  ' + ea.displayName + ' to images ...');
                const imagesArray = await convert(pdfBase64Content, { base64: true, image_format: 'image/jpeg', height:  (process.env.NEXT_PUBLIC_PDF_MAX_HEIGHT ? parseFloat(process.env.NEXT_PUBLIC_PDF_MAX_HEIGHT) : 3200)   /*, scale: process.env.NEXT_PUBLIC_PDF_SCALE ? parseFloat(process.env.NEXT_PUBLIC_PDF_SCALE) : 0.9 }*/}, pdfjs)
              if (statusUpdates) toast.info('File converted to ' + imagesArray.length + ' images');  
              for (let i = 0; i < imagesArray.length; i++){
                attachments.push({
                  name: ea.displayName + ' page ' + (i+1),
                  contentType: 'image/jpeg',
                  url: imagesArray[i]
                })
              }
      
            } else {
              attachments.push({
                name: ea.displayName,
                contentType: ea.mimeType,
                url: await getAttachmentData(ea.toDTO(), AttachmentFormat.dataUrl) as string // TODO: convert PDF attachments to images here
              })
            }
          } catch (error) {
            console.error(error);
            if (statusUpdates) toast.error('Error downloading attachment: ' + error);
          }
        }
        cacheStorage.put(cacheKey, new Response(JSON.stringify(attachments)));
        return attachments;
      }
    
      const extraToRecord = async (type: string, promptText: string, record: Record) => {
    
        chatContext.setChatOpen(true);
          chatContext.sendMessage({
            message: {
              role: 'user',
              createdAt: new Date(),
              content: promptText,
              type: MessageType.Parse // this will prevent from adding the whole context              
            },
            onResult: (resultMessage, result) => {    
              if (result.finishReason !== 'error') {
                let recordEXTRA = record.extra || []
                recordEXTRA.find(p => p.type === type) ? recordEXTRA = recordEXTRA.map(p => p.type === type ? { ...p, value: result.text } : p) : recordEXTRA.push({ type: type, value: result.text })
                console.log(recordEXTRA);
                record = new Record({ ...record, extra: recordEXTRA });
                updateRecord(record);          
              }
            }
          })
      }
    
      const updateOperationProgress = async (record: Record, operation: string, inProgress: boolean, progress: number = 0, progressOf: number = 0, page: number = 0, pages: number = 0, metadata: any = null, error: any = null) : Promise<Record> => {


        record.operationName = operation;
        record.operationInProgress = inProgress;
        record.operationError = error;

        if(inProgress !== record.operationInProgress || error !== record.operationError) {
          setRecords(prevRecords => prevRecords.map(pr => pr.id === record.id ? record : pr)); // update state
        }

        if (progress > 0 && progressOf > 0) {

          record.operationProgress = {
            operationName: operation,
            page: page,
            pages: pages,
            progress: progress,
            progressOf: progressOf,
            textDelta: metadata?.textDelta,
            pageDelta: metadata?.pageDelta,
            recordText: metadata?.recordText
          }

          if (metadata && metadata.pageDelta && metadata.recordText) { // new page parsed
            record.text = metadata.recordText;
            record = await setRecordExtra(record, 'Page ' + page.toString() + ' content', metadata.pageDelta, false); // update the record parse progress

            if (progress === (progressOf - 1)) {
              removeRecordExtra(record, 'Document parsed pages', false);
            } else {
              record = await setRecordExtra(record, 'Document parsed pages', page.toString(), false); // update the record parse progress
              record = await setRecordExtra(record, 'Document pages total', pages.toString(), false); // update the record parse progress
            }
  
            record = await updateRecord(record);
          }
            
          // Save parsing progress in context state
          setOperationProgressByRecordId(prev => {
            const id = record.id?.toString() || 'unknown';
            const prevHistory = prev[id]?.history || [];
            return {
              ...prev,
              [id]: {
                operationName: operation,
                progress,
                progressOf,
                page,
                pages,
                metadata,
                textDelta: (prev[id]?.textDelta || '') + (metadata?.textDelta || ''),
                pageDelta: metadata?.pageDelta || '',
                recordText: metadata?.recordText || '',
                history: [
                  ...prevHistory,
                  { operationName: operation, progress, progressOf, metadata, page, pages, textDelta: metadata?.textDelta || '', pageDelta: metadata?.pageDelta || '', recordText: metadata?.recordText || '', timestamp: Date.now() }
                ]
              }
            };
          });
        }

        return record;
      }

      const processParseQueue = async () => {
        if (parseQueueInProgress) {
          for(const pr of parseQueue) {
            await updateOperationProgress(pr, RegisteredOperations.Parse, true);
          }
          console.log('Parse queue in progress');
          return;
        }

        let currentRecord = null;
        parseQueueInProgress = true;
        while (parseQueue.length > 0) {
          try {
            currentRecord = parseQueue[0] as Record;
            console.log('Processing record: ', currentRecord, parseQueue.length);
            await updateOperationProgress(currentRecord, RegisteredOperations.Parse, true);
            
            setOperationStatus(DataLoadingStatus.Loading);
            const attachments = await convertAttachmentsToImages(currentRecord);
            setOperationStatus(DataLoadingStatus.Success);

            // Parsing is two or three stage operation: 1. OCR, 2. <optional> sensitive data removal, 3. LLM
            const ocrProvider = await config?.getServerConfig('ocrProvider') || 'llm-aged'; // default LLM provider
            console.log('Using OCR provider:', ocrProvider);

            let updatedRecord: Record | null = null;
            try {
              if (ocrProvider === 'chatgpt') {
                updatedRecord = await chatgptParseRecord(currentRecord, chatContext, config, folderContext, updateRecordFromText, updateOperationProgress, attachments);
              } else if (ocrProvider === 'tesseract') {
                updatedRecord = await tesseractParseRecord(currentRecord, chatContext, config, folderContext, updateRecordFromText, updateOperationProgress, attachments);
              } else if (ocrProvider === 'gemini') {
                updatedRecord = await geminiParseRecord(currentRecord, chatContext, config, folderContext, updateRecordFromText, updateOperationProgress, attachments);
              } else if (ocrProvider === 'llm-paged') {
                updatedRecord = await chatgptPagedParseRecord(currentRecord, chatContext, config, folderContext, updateRecordFromText, updateOperationProgress, attachments);
              } else {
                toast.error('Unknown OCR provider: ' + ocrProvider);
                updatedRecord = null;
              }

              // Execute post-parse callback if exists
              if (updatedRecord && currentRecord.postParseCallback) {
                await currentRecord.postParseCallback(updatedRecord);
              }
            } catch (error) {
              console.error('Error processing record:', error);
              toast.error('Error processing record: ' + error);
              if (currentRecord) updateOperationProgress(currentRecord, RegisteredOperations.Parse, false, 0, 0, 0, 0, null, error);
            }

            console.log('Record parsed, taking next record', currentRecord);
            parseQueue = parseQueue.slice(1); // remove one item
            parseQueueLength = parseQueue.length;
          } catch (error) {
            parseQueue = parseQueue.slice(1); // remove one item
            parseQueueLength = parseQueue.length;

            if (currentRecord) updateOperationProgress(currentRecord, RegisteredOperations.Parse, false, 0, 0, 0, 0, null, error);
          }
        }
        parseQueueInProgress = false;
      }      
    
      const parseRecord = async (newRecord: Record, postParseCallback?: PostParseCallback)=> {
        if (!parseQueue.find(pr => pr.id === newRecord.id) && (newRecord.attachments.length > 0 || newRecord.transcription)) {
          if (postParseCallback) {
            newRecord.postParseCallback = postParseCallback;
          }
          parseQueue.push(newRecord)
          parseQueueLength = parseQueue.length
          console.log('Added to parse queue: ', parseQueue.length);
        }
        processParseQueue();
      }

      const sendAllRecordsToChat = async (customMessage: CreateMessageEx | null = null, providerName?: string, modelName?: string, onResult?: OnResultCallback) => {
        return new Promise((resolve, reject) => {
          // chatContext.setChatOpen(true);
          if (records.length > 0) {
            const msgs:CreateMessageEx[] = [{
              role: 'user' as Message['role'],
              //createdAt: new Date(),
              visibility: MessageVisibility.Hidden, // we don't show folder records context
              content: prompts.recordsToChat({ records, config }),
            }, ...records.map((record) => {
              return {
                role: 'user' as Message['role'],
                visibility: MessageVisibility.Hidden, // we don't show folder records context
                //createdAt: new Date(),
                content: prompts.recordIntoChatSimplified({ record })
              }
          }), {
            role: 'user',
            visibility: MessageVisibility.Visible, // we don't show folder records context
            //createdAt: new Date(),
            content: prompts.recordsToChatDone({ records, config }),
          }];

          if(customMessage) {
            msgs.push(customMessage);
          }

            const preUsage = new GPTTokens({
              model   : 'gpt-4o',
              messages: msgs as GPTTokens["messages"]
            });

            console.log('Context msg tokens', preUsage.usedTokens, preUsage.usedUSD);
            chatContext.setRecordsLoaded(true);
            chatContext.sendMessages({
                messages: msgs, providerName, onResult: (resultMessage, result) => {
                console.log('All records sent to chat');
                if (onResult) onResult(resultMessage, result);
                if (result.finishReason !== 'error') {
                  resolve(result);
                } else {
                  reject(result);
                }
              }
            })
          }
        });
      }

      const importRecords = async (zipFileInput:ArrayBuffer) => {
        try {
          if (!folderContext?.currentFolder) {
            toast.error('No folder selected');
            return;
          }
          const zip = new JSZip();
          const zipFile = await zip.loadAsync(zipFileInput as ArrayBuffer);
          const recordsFile = zipFile.file('records.json');
          const recordsJSON = await recordsFile?.async('string');
          const recordsData = JSON.parse(recordsJSON as string);
          const records = recordsData.map((recordDTO: RecordDTO) => Record.fromDTO(recordDTO)) as Record[];
          console.log('Imported records: ', records);
          const encUtils = dbContext?.masterKey ? new EncryptionUtils(dbContext.masterKey as string) : null;
          const encFilter = dbContext?.masterKey ? new DTOEncryptionFilter(dbContext.masterKey as string) : null;

          let idx = 1;
          for(const record of records) {
            try {
              delete record.id; // new id is required
              toast.info('Importing record (' + idx + ' of ' + records.length + '): ' + record.title);
              record.folderId = folderContext?.currentFolder?.id ?? 1;
              const uploadedAttachments:EncryptedAttachmentDTO[] = [];

              if (record.attachments) {
                  for(const attachment of record.attachments) {
                    if(attachment.filePath) {
                      const attachmentContent = await zipFile.file(attachment.filePath)?.async('arraybuffer');
                      if (attachmentContent) {
                        const encryptedBuffer = await encUtils?.encryptArrayBuffer(attachmentContent as ArrayBuffer) as ArrayBuffer;
                        const encryptedFile = new File([encryptedBuffer], attachment.displayName, { type: attachment.mimeType });
                        const formData = new FormData();
                        formData.append("file", encryptedFile); // TODO: encrypt file here
        
                      let attachmentDTO: EncryptedAttachmentDTO = attachment.toDTO();
                      delete attachmentDTO.id;
                      delete attachmentDTO.filePath;
                    
                      attachmentDTO = encFilter ? await encFilter.encrypt(attachmentDTO, EncryptedAttachmentDTOEncSettings) as EncryptedAttachmentDTO : attachmentDTO;
                      formData.append("attachmentDTO", JSON.stringify(attachmentDTO));
                      try {
                        const apiClient = new EncryptedAttachmentApiClient('', dbContext, saasContext, {
                          useEncryption: false  // for FormData we're encrypting records by ourselves - above
                        })
                        toast.info('Uploading attachment: ' + attachment.displayName);
                        const result = await apiClient.put(formData);
                        if (result.status === 200) {
                          const decryptedAttachmentDTO: EncryptedAttachmentDTO = (encFilter ? await encFilter.decrypt(result.data, EncryptedAttachmentDTOEncSettings) : result.data) as EncryptedAttachmentDTO;
                          console.log('Attachment saved', decryptedAttachmentDTO);
                          uploadedAttachments.push(decryptedAttachmentDTO);
                        }
                      } catch (error) {
                        console.error(error);
                        toast.error('Error saving attachment: ' + error);
                      } 
                    }
                  }
                }
              }
              record.attachments = uploadedAttachments.map(ea => new EncryptedAttachment(ea));
              console.log('Importing record: ', record);
              const updatedRecord = await updateRecord(record);
            } catch (error) {
              console.error(error);
              toast.error('Error importing record: ' + error);
            }
            idx++;
          }
          toast.success('Records imported successfully!');
        } catch (error) {
          console.error(error);
          toast.error('Error importing records: ' + error);
        }
      }

      const exportRecords = async () => {
        // todo: download attachments

        const prepExportData = filteredRecords.map(record => record);
        toast.info('Exporting ' + prepExportData.length + ' records');

        const zip = new JSZip();
        const converter = new showdown.Converter({ tables: true, completeHTMLDocument: true, openLinksInNewWindow: true });
        converter.setFlavor('github');

        let indexMd = '# DoctorDok Export\n\n';

        toast.info('Downloading attachments ...');
        for(const record of prepExportData) {
          if (record.attachments) {
            const recordNiceName = filenamify(record.eventDate ? (record.eventDate + ' - ' + record.title) : (record.createdAt + (record.title ? ' - ' + record.title : '')), {replacement: '-'});
            const folder = zip.folder(recordNiceName)
            if (record.text) {
              folder?.file(filenamify(recordNiceName) + '.md', record.text);
              folder?.file(filenamify(recordNiceName) + '.html', converter.makeHtml(record.text));
              indexMd += `- <a href="${recordNiceName}/${filenamify(recordNiceName)}.md">${record.eventDate ? record.eventDate : record.createdAt} - ${record.title}</a>\n\n`;
            }

            for(const attachment of record.attachments) {
              try {
                const attFileName = filenamify(attachment.displayName.replace('.','-' + attachment.id + '.'), {replacement: '-'});
                toast.info('Downloading attachment: ' + attachment.displayName);
                const attBlob = await getAttachmentData(attachment.toDTO(), AttachmentFormat.blob, true);
                if (folder) folder.file(attFileName, attBlob as Blob);

                attachment.filePath = recordNiceName + '/' + attFileName // modify for the export
                indexMd += ` - <a href="${recordNiceName}/${attFileName}">${attFileName}</a>\n\n`;

              } catch (e) {
                console.error(e);
                toast.error(getErrorMessage(e));
              }
            }
          }
        }
        try {
          const exportData = filteredRecords.map(record => record.toDTO());
          const exportBlob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
          zip.file('records.json', exportBlob);
          zip.file('index.md', indexMd);
          zip.file('index.html', converter.makeHtml(indexMd.replaceAll('.md', '.html')));

          toast.info('Creating ZIP archive ...');
          const exportFileName = 'DoctorDok-export' + filenamify(filterSelectedTags && filterSelectedTags.length ? '-' + filterSelectedTags.join('-') : '') + '.zip';
          const zipFileContent = await zip.generateAsync({type:"blob"});

          toast.info('All records exported!')
          saveAs(zipFileContent, exportFileName);
        } catch (e) {
          console.error(e);
          toast.error(getErrorMessage(e));
        }
      }
    
      const sendRecordToChat = async (record: Record, forceRefresh: boolean = false) => {
        if (!record.json || forceRefresh) {  // first: parse the record
          await parseRecord(record);
        } else {
          chatContext.setChatOpen(true);
          chatContext.sendMessage({
            message: {
              role: 'user',
              createdAt: new Date(),
              content: prompts.recordIntoChat({ record, config }),
            }
          });
        }
      }  
      
      const removeRecordExtra = async (record: Record, type: string, autosaveRecord: boolean = true) => {
        let recordEXTRA = record.extra || []
        recordEXTRA = recordEXTRA.filter(p => p.type !== type)
        record = new Record({ ...record, extra: recordEXTRA }) as Record;
        if (autosaveRecord) {
          return await updateRecord(record);
        }
        return record;
      }

    const setRecordExtra = async (record: Record, type: string, value: string, autosaveRecord: boolean = true): Promise<Record> => {
        let recordEXTRA = record.extra || []
        recordEXTRA.find(p => p.type === type) ? recordEXTRA = recordEXTRA.map(p => p.type === type ? { ...p, value } : p) : recordEXTRA.push({ type, value })
        record = new Record({ ...record, extra: recordEXTRA });
        if (autosaveRecord) {
          return await updateRecord(record);
        }
        return record;
    }

    const translateRecord = async (record: Record, language: string = 'English') => {
      try {
        const parseAIProvider = await config?.getServerConfig('llmProviderParse') as string;
        const parseModelName = await config?.getServerConfig('llmModelParse') as string;

        // Gather all page contents from record.extra
        const pages: string[] = [];
        let pageNum = 1;
        while (true) {
          const pageContent = await getRecordExtra(record, 'Page ' + pageNum + ' content');
          if (!pageContent) break;
          pages.push(pageContent as string);
          pageNum++;
        }
        if (pages.length === 0 && record.text) {
          pages.push(record.text);
        }

        let translatedPages: string[] = [];
        let progress = 0;
        setOperationStatus(DataLoadingStatus.Loading);
        // --- Translation progress bar support ---
        record = await updateOperationProgress(record, RegisteredOperations.Translate, true, 0, pages.length, 0, pages.length, null, null);
        // Prepare a placeholder for the translated record (will be created after all pages are translated)
        let pagesTokensProcessed = 0;
        let totalPagesTokens = AVERAGE_PAGE_TOKENS * pages.length;

        for (let i = 0; i < pages.length; i++) {
          let translatedPage = '';
          const stream = chatContext.aiDirectCallStream([
            {
              id: nanoid(),
              role: 'user',
              createdAt: new Date(),
              content: prompts.translateRecordTextByPage({ record, language, page: i + 1, pageContent: pages[i] }),
            }
          ], undefined, parseAIProvider, parseModelName);
          let pageTokens = 0;
          for await (const delta of stream) {
            translatedPage += delta;
            pageTokens += 1;
            pagesTokensProcessed += 1;
            // Update translation progress UI here
            record = await updateOperationProgress(record, RegisteredOperations.Translate, true, pagesTokensProcessed, totalPagesTokens, i + 1, pages.length, { textDelta: delta }, null);
          }
          translatedPages.push(translatedPage);
          // Update after each page is finished

          totalPagesTokens -=AVERAGE_PAGE_TOKENS;
          totalPagesTokens += pageTokens * 1.7; // we estimate the metadata to be twice as long as the text for metadata
          record = await updateOperationProgress(record, RegisteredOperations.Translate, true, pagesTokensProcessed, totalPagesTokens, i + 1, pages.length, { pageDelta: translatedPage }, null);
        }
        // Join translated pages
        const translatedText = translatedPages.join('\n\n');

        // Generate metadata for the translated text
        let metaDataJson = '';
        const metadataStream = chatContext.aiDirectCallStream([
          {
            id: nanoid(),
            role: 'user',
            createdAt: new Date(),
            content: prompts.recordParseMetadata({ record, config, page: pages.length, recordContent: translatedText }),
          }
        ], undefined, parseAIProvider, parseModelName);
        
        for await (const delta of metadataStream) {
          metaDataJson += delta;
          pagesTokensProcessed += 1;
          // Update translation progress UI here
          record = await updateOperationProgress(record, RegisteredOperations.Translate, true, pagesTokensProcessed, totalPagesTokens, pages.length, pages.length, { textDelta: delta }, null);
      }
        metaDataJson = metaDataJson.replace(/```[a-zA-Z]*\n?|```/g, '');
        const fullTextToProcess = '```json\n' + metaDataJson + '\n```\n\n```markdown\n' + translatedText + '\n```';

        // Create a copy of the original record's attachments
        const attachmentsCopy = record.attachments.map(att => att.toDTO());
        let translatedRecord = await updateRecordFromText(fullTextToProcess, null, true, [
          { type: 'Reference record Ids', value: record.id?.toString() || '' },
          { type: 'Translation language', value: language },
          { type: 'Preserved attachments', value: attachmentsCopy.map(att => att.id).join(', ') }
        ]); // creates new record

        if (!translatedRecord) {
          setOperationStatus(DataLoadingStatus.Error);
          // End translation progress
          record = await updateOperationProgress(record, RegisteredOperations.Translate, false, pagesTokensProcessed, pagesTokensProcessed, pages.length, pages.length, null, 'Failed to create translated record');
          throw new Error('Failed to create translated record');
        }

        // Now that we have the translated record, set the extras for each page
        for (let i = 0; i < translatedPages.length; i++) {
          translatedRecord = await setRecordExtra(translatedRecord, `Page ${i + 1} content`, translatedPages[i], false);
        }

        // Update the translated record with the original attachments and eventDate
        translatedRecord.attachments = attachmentsCopy.map(dto => new EncryptedAttachment(dto));
        translatedRecord.eventDate = record.eventDate || record.createdAt;
        

        // Create a bi-directional reference by updating the original record
        const translationRefsKey = 'Reference record Ids';
        const existingTranslationRefs = record.extra?.find(e => e.type === translationRefsKey);
        if (existingTranslationRefs && typeof existingTranslationRefs.value === 'string') {
          // If there are existing translations, append the new one
          const existingIds = existingTranslationRefs.value.split(',').map(id => id.trim());
          if (!existingIds.includes(translatedRecord.id?.toString() || '')) {
            existingTranslationRefs.value = [...existingIds, translatedRecord.id?.toString() || ''].join(', ');
            record = await setRecordExtra(record, translationRefsKey, existingTranslationRefs.value as string, false);
          }
        } else {
          // If this is the first translation, create new reference
          record = await setRecordExtra(record, translationRefsKey, translatedRecord.id?.toString() || '', false);
        }

        record = await updateRecord(record); // save changes to original record
        translatedRecord = await updateRecord(translatedRecord); // save changes to translated record

        setOperationStatus(DataLoadingStatus.Success);
        // End translation progress
        await updateOperationProgress(record, RegisteredOperations.Translate, false, pagesTokensProcessed, pagesTokensProcessed, pages.length, pages.length, null, null);
        return translatedRecord;

      } catch (error) {
        setOperationStatus(DataLoadingStatus.Error);
        // End translation progress with error
        await updateOperationProgress(record, RegisteredOperations.Translate, false, 0, 0, 0, 0, null, error);
        console.error('Error translating record:', error);
        toast.error('Error translating record: ' + error);
        throw error;
      }
    }

    return (
        <RecordContext.Provider
            value={{
                 records, 
                 filteredRecords,
                 parseQueueLength,
                 updateRecordFromText,
                 updateRecord, 
                 loaderStatus, 
                 operationStatus,
                 setOperationStatus,
                 setCurrentRecord, 
                 currentRecord, 
                 listRecords, 
                 deleteRecord, 
                 recordEditMode, 
                 setRecordEditMode,
                 getAttachmentData,
                 downloadAttachment,
                 convertAttachmentsToImages,
                 extraToRecord,
                 parseRecord,
                 sendRecordToChat,
                 sendAllRecordsToChat,
                 processParseQueue,
                 filterAvailableTags,
                 filterSelectedTags,
                 setFilterSelectedTags,
                 filterToggleTag,
                 filtersOpen,
                 setFiltersOpen,
                 sortBy,
                 setSortBy,
                 getTagsTimeline,
                 exportRecords,
                 importRecords,
                 recordDialogOpen,
                 setRecordDialogOpen,
                 setRecordExtra,
                 removeRecordExtra,
                 setOperationProgressByRecordId,
                 translateRecord,
                 operationProgressByRecordId,
                 parsingDialogOpen,
                 setParsingDialogOpen,
                 parsingDialogRecordId,
                 setParsingDialogRecordId
                }}
        >
            {children}
        </RecordContext.Provider>
    );
};
