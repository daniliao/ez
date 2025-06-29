import { EncryptedAttachmentDTO, KeyACLDTO, KeyDTO, FolderDTO, RecordDTO, TermDTO } from "@/data/dto";
import { z } from "zod";

import PasswordValidator from 'password-validator';
import { getCurrentTS } from "@/lib/utils";
import { sha256 } from "@/lib/crypto";

export enum RegisteredOperations {
    Parse = 'parse',
    Translate = 'translate'
}

export const AVERAGE_PAGE_TOKENS = 1000;
 


export enum DataLoadingStatus {
    Idle = 'idle',
    Loading = 'loading',
    Success = 'success',
    Error = 'error',
}

export enum DatabaseAuthStatus {
    Empty = 'Empty',
    NotAuthorized = 'NotAuthorized',
    AuthorizationError = 'AuthorizationError',
    Authorized = 'Success',
    InProgress = 'InProgress'
}

export class Folder {
    id?: number;
    name: string;
    updatedAt?: string;
    json?: Record<string, any>;

    constructor(folderDTO: FolderDTO | Folder) {
        this.id = folderDTO.id;
        this.name = folderDTO.name;
        this.updatedAt = folderDTO.updatedAt;
        if (folderDTO instanceof Folder) {
            this.json = folderDTO.json;
        } else {
            this.json = folderDTO.json ? (typeof folderDTO.json === 'string' ? JSON.parse(folderDTO.json) : folderDTO.json) : null;
        }   
    }

    static fromDTO(folderDTO: FolderDTO): Folder {
        return new Folder(folderDTO);
    }    

    toDTO(): FolderDTO {
        return {
            id: this.id,
            name: this.name,
            updatedAt: this.updatedAt ? this.updatedAt : new Date().toISOString(),
            json: JSON.stringify(this.json),
        };
    }

    displayName(): string {
        return this.name;
    }
    avatarFallback(): string {
        return (this.name[0] + (this.name.length > 1 ? this.name[1] : '')).toUpperCase();
    }    
}

export type AttachmentAssigment = {
    id: number;
    type: string;
}

export type DisplayableDataObject =  {
    contentType?: string;
    url: string;
    name: string;
}

export class EncryptedAttachment {
    id?: number;
    assignedTo?: AttachmentAssigment[];
    displayName: string;
    description?: string;
    mimeType?: string;
    type?: string;
    json?: string;
    extra?: string;
    size: number;
    storageKey: string;
    filePath?: string;
    createdAt: string;
    updatedAt: string;

    constructor(attachmentDTO: EncryptedAttachmentDTO) {
        this.id = attachmentDTO.id;
        this.assignedTo = attachmentDTO.assignedTo ? ( typeof attachmentDTO.assignedTo == 'string' ? JSON.parse(attachmentDTO.assignedTo) : attachmentDTO.assignedTo ): [];
        this.displayName = attachmentDTO.displayName;
        this.description = attachmentDTO.description ? attachmentDTO.description : '';
        this.mimeType = attachmentDTO.mimeType ? attachmentDTO.mimeType : '';
        this.type = attachmentDTO.type ? attachmentDTO.type : '';
        this.json = attachmentDTO.json ? attachmentDTO.json : '';
        this.extra = attachmentDTO.extra ? attachmentDTO.extra : '';
        this.size = attachmentDTO.size;
        this.storageKey = attachmentDTO.storageKey;
        this.filePath = attachmentDTO.filePath ? attachmentDTO.filePath : '';
        this.createdAt = attachmentDTO.createdAt;
        this.updatedAt = attachmentDTO.updatedAt;
    }

    static fromDTO(fileDTO: EncryptedAttachmentDTO): EncryptedAttachment {
        return new EncryptedAttachment(fileDTO);
    }

    toDTO(): EncryptedAttachmentDTO {
        return {
            id: this.id,
            assignedTo: JSON.stringify(this.assignedTo),
            displayName: this.displayName,
            description: this.description,
            mimeType: this.mimeType,
            type: this.type,
            json: this.json,
            extra: this.extra,
            size: this.size,
            storageKey: this.storageKey,
            filePath: this.filePath,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}

export const recordExtraSchema = z.object({
    type: z.string().min(1),
    value: z.string().min(1).or(z.array(z.string().min(1))).or(z.object({}))
});
export type RecordExtra = z.infer<typeof recordExtraSchema>;

export const recordItemSchema = z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    tags: z.array(z.string()),
    type: z.string().min(1),
    subtype: z.string().optional(),
    language: z.string().optional(),
    test_date: z.date().optional(),
    admission_date: z.date().optional(),
    discharge_date: z.date().optional(),
    conclusion: z.string().optional(),
    diagnosis: z.array(z.object({})).optional(),
    findings: z.array(z.object({
        name: z.string().optional(),
        value: z.string().optional(),
        unit: z.string().optional(),
        min: z.string().optional(),
        max: z.string().optional(),
        interpretation: z.string().optional(),
        notes: z.string().optional(),
    }).or(z.string())).optional()

  });
  
export type RecordItem = z.infer<typeof recordItemSchema>;

export type PostParseCallback = (record: Record) => Promise<void>;

export type OperationProgress = {
    page: number;
    pages: number;
    operationName?: string;
    progress: number;
    progressOf: number;
    textDelta?: string;
    pageDelta?: string;
    recordText?: string;
    processedOnDifferentDevice?: boolean;
    message?: string;
}
export class Record {
    id?: number;
    folderId: number;
    description?: string;
    title?: string;
    tags?: string[];
    type: string;
    json?: RecordItem[] | null;
    text?: string;
    extra?: RecordExtra[] | null;
    transcription?: string;
    eventDate: string;
    createdAt: string;
    updatedAt: string;
    attachments: EncryptedAttachment[] = [];

    checksum: string;
    checksumLastParsed: string;

    operationName: string = '';
    operationInProgress: boolean = false;
    operationError: any = null;
    operationProgress?: OperationProgress;
    postParseCallback?: PostParseCallback;
  
    constructor(recordSource: RecordDTO | Record) {
      this.id = recordSource.id;
      this.folderId = recordSource.folderId;
      this.title = recordSource.title ? recordSource.title : '';
      this.description = recordSource.description ? recordSource.description : '';
      this.type = recordSource.type;
      this.transcription = recordSource.transcription ? recordSource.transcription : '';
      this.text = recordSource.text ? recordSource.text : '';
      this.checksum = recordSource.checksum ? recordSource.checksum : '';
      this.checksumLastParsed = recordSource.checksumLastParsed ? recordSource.checksumLastParsed : '';
      this.operationInProgress = recordSource.operationInProgress ? recordSource.operationInProgress : false;
      this.operationProgress = recordSource.operationProgress ? recordSource.operationProgress : undefined;
      this.operationName = recordSource.operationName ? recordSource.operationName : '';
      

      
    if(recordSource instanceof Record) {
        this.tags = recordSource.tags
     } else {
        this.tags = recordSource.tags ? (typeof recordSource.tags === 'string' ? JSON.parse(recordSource.tags) : recordSource.tags) : null;
     }

      if(recordSource instanceof Record) {
        this.json = recordSource.json
     } else {
        this.json = recordSource.json ? (typeof recordSource.json === 'string' ? JSON.parse(recordSource.json) : recordSource.json) : null;
     }

     if(recordSource instanceof Record) {
        this.extra = recordSource.extra
     } else {
        this.extra = recordSource.extra ? (typeof recordSource.extra === 'string' ? JSON.parse(recordSource.extra) : recordSource.extra) : null;
     }
      this.eventDate = recordSource.eventDate;
      this.createdAt = recordSource.createdAt;
      this.updatedAt = recordSource.updatedAt;
      if(recordSource instanceof Record) {
         this.attachments = recordSource.attachments
      } else {
         this.attachments = recordSource.attachments ? (typeof recordSource.attachments === 'string' ? JSON.parse(recordSource.attachments) : recordSource.attachments).map(EncryptedAttachment.fromDTO) : [];
      }
    }
  
    static fromDTO(recordDTO: RecordDTO): Record {
      return new Record(recordDTO);
    }

    async cacheKey(databaseHashId: string = ''): Promise<string> {
        const attachmentsHash = await sha256(this.attachments.map(ea => ea.storageKey).join('-'), 'attachments')
        const cacheKey = `record-${this.description}-${attachmentsHash}-${databaseHashId}`;
        return cacheKey
    }

    async attachmentsKey(databaseHashId: string = ''): Promise<string> {
        const attachmentsHash = await sha256(this.attachments.map(ea => ea.storageKey).join('-'), 'attachments')
        const cacheKey = `record-${attachmentsHash}-${databaseHashId}`;
        return cacheKey
    }

    async updateChecksum(): Promise<void> {
        this.checksum = (await this.attachmentsKey()) + (this.transcription  ? await sha256(this.transcription ? this.transcription : '', 'transcription') : '');
        console.log('Checksum updated ', this.id, this.checksum);
    }
    async updateChecksumLastParsed(): Promise<void> {
        this.checksumLastParsed = (await this.attachmentsKey()) + (this.transcription  ? await sha256(this.transcription ? this.transcription : '', 'transcription') : '');
        console.log('Checksum last parsed updated ', this.id, this.checksumLastParsed);
    }
  
    toDTO(): RecordDTO {
      return {
        id: this.id,
        folderId: this.folderId,
        title: this.title,
        tags: JSON.stringify(this.tags),
        description: this.description,
        type: this.type,
        json: JSON.stringify(this.json),
        text: this.text ? this.text : '',
        extra: JSON.stringify(this.extra),
        transcription: this.transcription ? this.transcription : '',
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        eventDate: this.eventDate,
        checksum: this.checksum,
        checksumLastParsed: this.checksumLastParsed,
        attachments: JSON.stringify(this.attachments.map(attachment => attachment.toDTO()))
      };
    }  
  }

export class KeyACL {
    role: string;
    features: string[];
    constructor(keyACLDTO: KeyACLDTO) {
        this.role = keyACLDTO.role;
        this.features = keyACLDTO.features;
    }

    static fromDTO(keyACLDTO: KeyACLDTO): KeyACL {
        return new KeyACL(keyACLDTO);
    }

    toDTO(): KeyACLDTO {
        return {
            role: this.role,
            features: this.features,
        };
    }

}

export class Key {
    displayName: string;
    keyLocatorHash: string;
    keyHash: string;
    keyHashParams: string;
    databaseIdHash: string;
    encryptedMasterKey: string;
    acl: KeyACL | null;
    extra: string | null;
    expiryDate: string | null;
    updatedAt: string;

    constructor(keyDTO: KeyDTO | Key) {
        this.displayName = keyDTO.displayName;
        this.keyLocatorHash = keyDTO.keyLocatorHash;
        this.keyHash = keyDTO.keyHash;
        this.keyHashParams = keyDTO.keyHashParams;
        this.databaseIdHash = keyDTO.databaseIdHash;
        this.encryptedMasterKey = keyDTO.encryptedMasterKey;
        this.acl = keyDTO instanceof Key ? keyDTO.acl :  (keyDTO.acl ? JSON.parse(keyDTO.acl) : null);
        this.extra = keyDTO.extra ?? null;
        this.expiryDate = keyDTO.expiryDate ?? null;
        this.updatedAt = keyDTO.updatedAt ?? getCurrentTS();
    }

    static fromDTO(keyDTO: KeyDTO): Key {
        return new Key(keyDTO);
    }

    toDTO(): KeyDTO {
        return {
            displayName: this.displayName,
            keyLocatorHash: this.keyLocatorHash,
            keyHash: this.keyHash,
            keyHashParams: this.keyHashParams,
            databaseIdHash: this.databaseIdHash,
            encryptedMasterKey: this.encryptedMasterKey,
            acl: JSON.stringify(this.acl),
            extra: this.extra,
            expiryDate: this.expiryDate,
            updatedAt: this.updatedAt,
        };
    }
}

export class Term {
    id?: number;
    content: string;
    key: string;
    signature: string;
    ip?: string;
    ua?: string;
    name?: string;
    email?: string;
    signedAt: string;
    code: string;

    constructor(termDTO: TermDTO | Term) {
        this.id = termDTO.id;
        this.key = termDTO.key;
        this.content = termDTO.content;
        this.signature = termDTO.signature;
        this.ip = termDTO.ip ?? '';
        this.ua = termDTO.ua ?? '';
        this.name = termDTO.name ?? '';
        this.code = termDTO.code;
        this.email = termDTO.email ?? '';
        this.signedAt = termDTO.signedAt;
    }

    static fromDTO(termDTO: TermDTO): Term {
        return new Term(termDTO);
    }

    toDTO(): TermDTO {
        return {
            id: this.id,
            key: this.key,
            code: this.code,
            content: this.content,
            signature: this.signature,
            ip: this.ip,
            ua: this.ua,
            name: this.name,
            email: this.email,
            signedAt: this.signedAt,
        };
    }
    
}

export class DatabaseCreateRequest {
    databaseId: string;
    key: string;

    constructor(databaseId: string, key: string) {
        this.databaseId = databaseId;
        this.key = key;
    }
}


export class DatabaseKeepLoggedInRequest {
    encryptedDatabaseId: string;
    encryptedKey: string;
    keepLoggedIn: boolean;

    constructor(encryptedDatabaseId: string, encryptedKey: string, keepLoggedIn: boolean) {
        this.encryptedDatabaseId = encryptedDatabaseId;
        this.encryptedKey = encryptedKey;;
        this.keepLoggedIn = keepLoggedIn;
    }
}

export class DatabaseAuthorizeRequest {
    databaseId: string;
    key: string;
    keepLoggedIn: boolean;

    constructor(databaseId: string, key: string, keepLoggedIn: boolean) {
        this.databaseId = databaseId;
        this.key = key;
        this.keepLoggedIn = keepLoggedIn;
    }
}

export class DatabaseRefreshRequest {
    refreshToken: string;
    keepLoggedIn?: boolean;

    constructor(refreshToken: string, keepLoggedIn?: boolean) {
        this.refreshToken = refreshToken;
        this.keepLoggedIn = keepLoggedIn;
    }
}


export const databaseIdValidator = (value:string) => {
    const passSchema = new PasswordValidator();
    passSchema.is().min(6).has().not().spaces();
    return passSchema.validate(value);
    
}
export const userKeyValidator = (value:string) => {
    const passSchema = new PasswordValidator();
    passSchema.is().min(6).has().not().spaces();
    return passSchema.validate(value);
}

export const sharingKeyValidator = (value:string) => {
    const passSchema = new PasswordValidator();
    passSchema.is().min(6).has().not().spaces().has().digits(6);
    return passSchema.validate(value);
}