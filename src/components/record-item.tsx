import React from 'react';
import { Button } from "@/components/ui/button";
import { DisplayableDataObject, Record, DataLoadingStatus } from "@/data/client/models";
import { useContext, useEffect, useRef, useState, ReactNode } from "react";
import { CalendarIcon, PencilIcon, TagIcon, Wand2Icon, XCircleIcon, DownloadIcon, PaperclipIcon, Trash2Icon, RefreshCw, MessageCircle, Languages, TextIcon, BookTextIcon, FileText, Loader2, LanguagesIcon } from "lucide-react";
import { RecordContext } from "@/contexts/record-context";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import Markdown from "react-markdown";
import { prompts } from "@/data/ai/prompts";
import remarkGfm from 'remark-gfm'
import styles from './record-item.module.css'
import { labels } from '@/data/ai/labels';
import DataLoader from './data-loader';
import RecordItemCommands from "@/components/record-item-commands";
import { FolderContext } from "@/contexts/folder-context";
import { ChatContext, MessageVisibility } from "@/contexts/chat-context";
import { ConfigContext } from "@/contexts/config-context";
import { toast } from "sonner";
import { DatabaseContext } from "@/contexts/db-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radix-ui/react-tabs";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import ZoomableImage from './zoomable-image';
import { convertRecordIdsToLinks } from '@/lib/utils';
import showdown from 'showdown';
import { Accordion, AccordionTrigger, AccordionContent, AccordionItem } from "./ui/accordion";

//import RecordItemJson from "@/components/record-item-json";
//import RecordItemExtra from '@/components/record-item-extra';


import removeMd from 'remove-markdown';
import dynamic from 'next/dynamic'
const RecordItemJson = dynamic(() =>
  import('@/components/record-item-json').then((mod) => mod.default),
  {
    loading: () => <div className="text-xs">Loading...</div>,
  }
)
const RecordItemExtra = dynamic(() =>
  import('@/components/record-item-extra').then((mod) => mod.default)
)

const MarkdownLinkHandler = ({node, href, children, ...props}: {node?: any; href?: string; children?: ReactNode; [key: string]: any}) => {
  if (href?.includes('image-')) {
    const imageId = href.startsWith('#') ? href.substring(1) : href;
    return (
      <a
        href="#"
        {...props}
        onClick={(e) => {
          e.preventDefault();
          if (typeof window !== 'undefined' && (window as any).zoomableImages && (window as any).zoomableImages[imageId]) {
            (window as any).zoomableImages[imageId].open();
          }
        }}
        className="text-black underline hover:text-blue-600 cursor-pointer"
      >
        {children}
      </a>
    );
  }
  return <a href={href} {...props}>{children}</a>;
};

export default function RecordItem({ record, displayAttachmentPreviews }: { record: Record, displayAttachmentPreviews: boolean }) {
  // TODO: refactor and extract business logic to a separate files
  const recordContext = useContext(RecordContext)
  const chatContext = useContext(ChatContext);
  const dbContext = useContext(DatabaseContext);
  const configContext = useContext(ConfigContext);
  const folderContext = useContext(FolderContext)
  const [displayableAttachmentsInProgress, setDisplayableAttachmentsInProgress] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false);
  const thisElementRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [lastlyLoadedCacheKey, setLastlyLoadedCacheKey] = useState('');
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('text');
  const [textAccordionValue, setTextAccordionValue] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

  const [displayableAttachments, setDisplayableAttachments] = useState<DisplayableDataObject[]>([]);

  const loadAttachmentPreviews = async () => {
    const currentCacheKey = await record.cacheKey(dbContext?.databaseHashId);
    if (displayAttachmentPreviews && !displayableAttachmentsInProgress && lastlyLoadedCacheKey !== currentCacheKey) {
      setDisplayableAttachmentsInProgress(true);
      try {
        const attachments = await recordContext?.convertAttachmentsToImages(record, false);
        setDisplayableAttachments(attachments as DisplayableDataObject[]);
        setDisplayableAttachmentsInProgress(false);
        setLastlyLoadedCacheKey(currentCacheKey)
      } catch(error) {
        setDisplayableAttachmentsInProgress(false);
      };
    }    
  }

  const shorten = (str: string, len = 16) => {
    if(str) {
      if(str.length > len) return str.slice(0, len ) + '...'; else return str;
    }
  return str;
  }

  useEffect(() => {

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      {
        root: null, // viewport
        rootMargin: '0px', // no margin
        threshold: 0.25, // 50% of target visible
      }
    );

    if (thisElementRef.current) {
      observer.observe(thisElementRef.current);
    }

    // Clean up the observer
/*    return () => {
      if (thisElementRef.current) {
        observer.unobserve(thisElementRef.current);
      }
    };*/
  }, [])

  useEffect(() => {

    if (isVisible) {      
      loadAttachmentPreviews();
    }

    async function parseRecord() {
      if (await configContext?.getServerConfig('autoParseRecord') && (record.checksum !== record.checksumLastParsed) && !record.parseInProgress && !record.parseError && (new Date().getTime() - new Date(record.updatedAt).getTime()) < 1000 * 60 * 60 /* parse only records changed up to 1 h */) { // TODO: maybe we need to add "parsedDate" or kind of checksum (better!) to make sure the record is parseed only when something changed
        console.log('Adding to parse queue due to checksum mismatch ', record.id, record.checksum, record.checksumLastParsed);
        const autoTranslate = await configContext?.getServerConfig('autoTranslateRecord');
        if (autoTranslate) {  // Check for exact string 'true'
          console.log('Auto-translate enabled, setting up callback');
          recordContext?.parseRecord(record, async (parsedRecord) => {
            console.log('Parse completed, starting translation');
            recordContext?.translateRecord(parsedRecord);
          });
        } else {
          console.log('Auto-translate disabled');
          recordContext?.parseRecord(record);
        }


      }
      recordContext?.processParseQueue();
    }
    parseRecord();
    
  }, [displayAttachmentPreviews, record, isVisible]);

  const downloadAsHtml = (text: string | undefined, filename: string) => {
    if (!text) return;
    const converter = new showdown.Converter({ tables: true, completeHTMLDocument: true, openLinksInNewWindow: true });
    converter.setFlavor('github');
    const htmlContent = converter.makeHtml(text);
    const htmlElement = document.createElement('a');
    const fileHtml = new Blob([htmlContent], { type: 'text/html' });
    htmlElement.href = URL.createObjectURL(fileHtml);
    htmlElement.download = filename + `.html`;
    document.body.appendChild(htmlElement);
    htmlElement.click();
    document.body.removeChild(htmlElement);
  }

  const handleImageClick = (imageId: string) => {
    if (typeof window !== 'undefined' && (window as any).zoomableImages && (window as any).zoomableImages[imageId]) {
      (window as any).zoomableImages[imageId].open();
    }
  };

  const handleImageLinkClick = (e: React.MouseEvent, imageId: string) => {
    e.preventDefault();
    handleImageClick(imageId);
  };

  const processText = (text: string | undefined | null, recordId: string | number | undefined) => {
    if (!recordId || !text) return '';
    
    // Keep the text as is - it's already in the correct markdown format
    return text;
  };

  // Add effect to log state changes
  useEffect(() => {
    console.log('Translation state changed:', isTranslating);
  }, [isTranslating]);

  const handleTranslation = async () => {
    if (record.parseInProgress) {
      toast.info('Please wait until record is successfully parsed');
      return;
    }
    
    console.log('Starting translation...');
    setIsTranslating(true);
    
    try {
      if (record.json) {
        console.log('Record already parsed, translating directly');
        const translatedRecord = await recordContext?.translateRecord(record);
        console.log('Translation completed:', translatedRecord);
      } else {
        console.log('Record not parsed, parsing first then translating');
        await new Promise<void>((resolve, reject) => {
          try {
            recordContext?.parseRecord(record, async (parsedRecord) => {
              try {
                console.log('Parse completed, starting translation');
                const translatedRecord = await recordContext?.translateRecord(parsedRecord);
                console.log('Translation completed:', translatedRecord);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    } catch (error) {
      console.error('Translation failed:', error);
      toast.error('Translation failed: ' + error);
    } finally {
      console.log('Translation process complete, resetting state');
      setIsTranslating(false);
    }
  };

  return (
      record.parseInProgress ? (
        <div className="bg-zinc-100 dark:bg-zinc-800 md:p-4 xs:p-2 md:rounded-md mb-4 xs:mb-2">
          <div className="text-sm text-zinc-500 dark:text-zinc-400 flex font-bold mb-4">
            Record saved succesfully, processing in progress...
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
            {record.attachments.map((attachment, index) => (
              <div key={index} className="text-sm inline-flex w-auto"><Button variant="outline" onClick={() => recordContext?.downloadAttachment(attachment.toDTO(), false)}><PaperclipIcon className="w-4 h-4 mr-2" /> {shorten(attachment.displayName)}</Button></div>
            ))}
          </div>
          {displayAttachmentPreviews && record.attachments.length > 0 ? (
            displayableAttachments.length > 0 ? (
              <div className="mt-2 flex-wrap flex items-center justify-left min-h-100 w-full">
                {displayableAttachments.map((attachment, index) => (
                  <ZoomableImage
                    key={`attachment-${record.id}-${index}`}
                    src={attachment.url}
                    alt={`Page ${index + 1}`}
                    width={100}
                    height={100}
                    className="w-100 pr-2 pb-2"
                    id={`image-${record.id}-${index}`}
                  />
                ))}
              </div>
            ): (displayableAttachmentsInProgress ? (<div className="mt-2 text-sm text-muted-foreground flex h-4 content-center gap-2">
                <div role="status" className="w-4">
                    <svg aria-hidden="true" className="w-4 h-4 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                        <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                    </svg>
                </div>          
                Loading previews ...
              </div>): null)
          ) : null}              

          <div className="text-sm text-zinc-500 dark:text-zinc-400 text-left font-medium flex justify-center mt-2 pr-3">
            For all cool AI features, we need to OCR and parse record data first. Records in queue: {recordContext?.parseQueueLength}. Do not close the browser window. Parsing record in progress... <DataLoader />
            <Button className="ml-2" onClick={
              () => {
                chatContext?.setChatOpen(true);
                if (chatContext && chatContext.lastMessage !== null) {
                  chatContext.lastMessage.visibility = MessageVisibility.Visible;
                }
              }
            }>Check progress...</Button>
          </div>

        </div>
      ) : (
      <div className="bg-zinc-100 dark:bg-zinc-800 md:p-4 xs:p-2 md:rounded-md mb-4 xs:mb-2">
        <div className="flex items-center justify-between mb-4">
          {record.title ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{record.id}: {record.title}</div>
          ) : (
            (record.json) ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{record.id}: {labels.recordItemLabel(record.type, { record })}</div>
            ) : (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{record.parseInProgress ? 'Parsing record in progres...' : 'Record uploaded, no additional data. Maybe try uploading again?' }</div>
            ) 
          )}
          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex"><CalendarIcon className="w-4 h-4" /> {record.eventDate ? record.eventDate : record.createdAt}</div>
        </div>
        {record.extra?.find(e => e.type === 'Reference record Ids')?.value && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            <div className="flex items-center">
              <span className="p-2 flex">
                <LanguagesIcon className="w-4 h-4 mr-2" /> Translations:
              </span>
              {(() => {
                const refId = record.extra?.find(e => e.type === 'Reference record Ids')?.value;
                const refIds = typeof refId === 'string' ? refId.split(',').map(id => id.trim()) : [];
                const refRecords = refIds.map(id => ({
                  id,
                  record: recordContext?.records.find(r => r.id?.toString() === id)
                }));
                
                return (
                  <div className="flex items-center">
                    {refIds.length > 0 && (
                      <div className="p-2">
                        {refIds.length === 1 ? (
                          <a href={`#records-${refIds[0]}`} className="text-zinc-500 dark:text-zinc-400 hover:text-blue-500 hover:underline">
                            {refRecords[0].record?.title || `#${refIds[0]}`}
                          </a>
                        ) : (
                          <>
                            <div className="text-zinc-500 dark:text-zinc-400">
                              {refRecords.map(({ id, record: refRecord }, index: number) => (
                                <React.Fragment key={id}>
                                  <a href={`#records-${id}`} className="text-zinc-500 dark:text-zinc-400 hover:text-blue-500 hover:underline">
                                    {refRecord?.title || `#${id}`}
                                  </a>
                                  {index < refIds.length - 1 && ', '}
                                </React.Fragment>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full text-sm">
          {(record.json || record.extra || record.transcription) ? (
            <TabsList className="grid grid-cols-2 gap-2">
              <TabsTrigger value="text" className="dark:data-[state=active]:bg-zinc-900 data-[state=active]:bg-zinc-300 rounded-md p-2">Basic view</TabsTrigger>
              <TabsTrigger value="json" className="dark:data-[state=active]:bg-zinc-900 data-[state=active]:bg-zinc-300 rounded-md p-2">Detailed view</TabsTrigger>
            </TabsList>
          ): ''}
            <TabsContent value="text" className="max-w-600">
              {record.description ? (
                <div className="mt-5 rose text-sm text-muted-foreground">
                  <Markdown 
                    className={styles.markdown} 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: MarkdownLinkHandler
                    }}
                  >
                    {convertRecordIdsToLinks(record.description, record.id)}
                  </Markdown>
                  {record.text && (
                    <div className="mt-2">
                      <Button 
                        variant="link" 
                        className="underline hover:text-blue-500 cursor-pointer p-0"
                        onClick={() => {
                          setActiveTab('json');
                          // Small delay to ensure tab content is rendered
                          setTimeout(() => {
                            setTextAccordionValue('item-1');
                          }, 100);
                        }}
                      >
                        <BookTextIcon className="w-4 h-4 mr-2" /> Read full record text
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
              
              {record.tags && record.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                  {record.tags.sort((a, b) => a.localeCompare(b)).map((tag, index) => (
                    <div key={index} className="text-sm inline-flex w-auto">
                      <Button 
                        variant={recordContext?.filterSelectedTags.includes(tag) ? 'default' : 'outline'}  
                        onClick={() => {
                          if (folderContext?.currentFolder) {
                            recordContext?.filterToggleTag(tag);
                          }      
                        }}
                      >
                        <TagIcon className="w-4 h-4 mr-2" /> 
                        {shorten(tag)}
                        {recordContext?.filterSelectedTags.includes(tag) && (
                          <XCircleIcon className="w-4 h-4 ml-2" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {record.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                  {record.attachments.map((attachment, index) => (
                    <div key={index} className="text-sm inline-flex w-auto">
                      <Button 
                        variant="outline" 
                        onClick={() => recordContext?.downloadAttachment(attachment.toDTO(), false)}
                      >
                        <PaperclipIcon className="w-4 h-4 mr-2" /> 
                        {shorten(attachment.displayName)}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="json" className="max-w-600">
              <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                {record.text && (
                  <Accordion type="single" collapsible className="w-full" value={textAccordionValue} onValueChange={setTextAccordionValue}>
                    <AccordionItem value="item-1">
                      <AccordionTrigger className="flex justify-between">
                        <span>Full text extracted from files</span>
                        <div className="flex gap-2">
                          <Button size="icon" variant="ghost" title="Edit text" onClick={(e) => {
                            e.stopPropagation(); // Prevent accordion from toggling
                            if(record.parseInProgress) { 
                              toast.info('Please wait until record is successfully parsed') 
                            } else {  
                              recordContext?.setCurrentRecord(record);  
                              recordContext?.setRecordEditMode(true); 
                            }
                          }}>
                            <PencilIcon className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title="Download as HTML" onClick={(e) => {
                            e.stopPropagation(); // Prevent accordion from toggling
                            downloadAsHtml(record.text, `record-${record.id}-text`);
                          }}>
                            <DownloadIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <Markdown 
                          className={styles.markdown} 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: MarkdownLinkHandler
                          }}
                        >
                          {convertRecordIdsToLinks(record.text || '', record.id)}
                        </Markdown>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
                
                <RecordItemJson record={record} />
                <RecordItemExtra record={record} />
                
                {record.transcription && (
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="item-1">
                      <AccordionTrigger>Transcription</AccordionTrigger>
                      <AccordionContent>
                        {record.transcription}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
                
                <div className="grid grid-cols-2 text-xs text-zinc-500 w-full mt-4">
                  <div className="text-xs text-muted-foreground">Record ID</div>
                  <div className="text-xs">{record.id}</div>
                  <div className="text-xs text-muted-foreground">Created at:</div>
                  <div className="text-xs">{record.createdAt}</div>
                  <div className="text-xs text-muted-foreground">Updated at:</div>
                  <div className="text-xs">{record.updatedAt}</div>
                </div>
              </div>
            </TabsContent>
        </Tabs>
        {displayAttachmentPreviews && record.attachments.length > 0 && displayableAttachments && (
          displayableAttachments.length > 0 ? (
            <div className="mt-4 flex-wrap flex items-center justify-left min-h-100 w-full">
              {displayableAttachments.map((attachment, index) => (
                <ZoomableImage
                  key={`attachment-${record.id}-${index}`}
                  src={attachment.url}
                  alt={`Page ${index + 1}`}
                  width={100}
                  height={100}
                  className="w-100 pr-2 pb-2 cursor-pointer"
                  id={`image-${record.id}-${index}`}
                />
              ))}
            </div>
          ) : displayableAttachmentsInProgress ? (
            <div className="mt-4 text-sm text-muted-foreground flex h-4 content-center gap-2 mb-4">
              <div role="status" className="w-4">
                <svg aria-hidden="true" className="w-4 h-4 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                  <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                </svg>
              </div>          
              Loading previews ...
            </div>
          ) : null
        )}
        <div ref={thisElementRef} className="mt-2 flex items-center gap-2">
          <Button size="icon" variant="ghost" title="Edit record" onClick={() => { if(record.parseInProgress) { toast.info('Please wait until record is successfully parsed') } else {  recordContext?.setCurrentRecord(record);  recordContext?.setRecordEditMode(true); } }}>
            <PencilIcon className="w-4 h-4" />
          </Button>        
          <Button size="icon" variant="ghost" title="Add attachments" onClick={() => { if(record.parseInProgress) { toast.info('Please wait until record is successfully parsed') } else {   recordContext?.setCurrentRecord(record);  recordContext?.setRecordEditMode(true);}  }}>
            <PaperclipIcon className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Download record as HTML" onClick={() => downloadAsHtml(record.text || record.description, `record-${record.id}`)}>
            <DownloadIcon className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Parse record" onClick={async () => {
            if (record.parseInProgress) {
              toast.info('Record parsing already in progress');
              return;
            }
          }}>
            <FileText className="w-4 h-4" />
          </Button>
          <Button 
            size="icon" 
            variant="ghost" 
            title="Translate to English" 
            disabled={isTranslating} 
            onClick={handleTranslation}
          >
            {isTranslating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Languages className="w-4 h-4" />
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger>
              <Button size="icon" variant="ghost" title="Delete record">
                <Trash2Icon className="w-4 h-4"/>
              </Button>            
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-white dark:bg-zinc-950">
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete your data record
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>No</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => recordContext?.deleteRecord(record)}>YES</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>         
          {record.json ? (
            <>
              <Button className="h-6 text-xs" variant="ghost" title="AI features" onClick={() => { setCommandsOpen(true) }}>
                Ready for AI: <Wand2Icon className="ml-3 w-4 h-4" />
              </Button>
              <RecordItemCommands record={record} folder={folderContext?.currentFolder} open={commandsOpen} setOpen={setCommandsOpen} />
            </>
          ) : record.attachments?.length > 0 || record.transcription ? (
            <Button className="h-6 text-xs" variant="ghost" title="Parse again" onClick={() => { recordContext?.parseRecord(record); }}>
              Try parse again: <RefreshCw className="ml-3 w-4 h-4" />
            </Button>
          ) : null}      
        </div>
      </div>
    )
  );
}
