import { BaseRepository, IQuery } from "./base-repository"
import { RecordDTO } from "../dto";
import { pool } from '@/data/server/db-provider'
import { getCurrentTS } from "@/lib/utils";
import { records } from "./db-schema";
import { eq } from "drizzle-orm";
import { create } from "./generic-repository";
import { desc, asc } from 'drizzle-orm';

export default class ServerRecordRepository extends BaseRepository<RecordDTO> {
    
    
    async create(item: RecordDTO): Promise<RecordDTO> {
        const db = (await this.db());
        return create(item, records, db); // generic implementation
    }

    // update folder
    async upsert(query:Record<string, any>, item: RecordDTO): Promise<RecordDTO> { 
        const db = (await this.db());       
        let existingRecord:RecordDTO | null = query.id ? db.select().from(records).where(eq(records.id, query.id)).get() as RecordDTO : null
        if (!existingRecord) {
            existingRecord = await this.create(item);
       } else {
            existingRecord = item
            existingRecord.updatedAt = getCurrentTS() // TODO: load attachments
            db.update(records).set(existingRecord).where(eq(records.id, query.id)).run();
       }
       return Promise.resolve(existingRecord as RecordDTO)   
    }    

    async delete(query: Record<string, string>): Promise<boolean> {
        const db = (await this.db());
        return db.delete(records).where(eq(records.id, parseInt(query.id))).run().changes > 0
    }

    async findAll(query?: IQuery): Promise<RecordDTO[]> {
        const db = (await this.db());
        let dbQuery = db.select().from(records);
        if(query?.filter){
            if(query.filter['folderId']){
                dbQuery.where(eq(records.folderId, parseInt(query.filter['folderId'] as string)));
            }
        }
        return Promise.resolve(dbQuery.all() as RecordDTO[])
    }

    async getLastUpdateDate(folderId: number): Promise<{ recordId: number; updatedAt: string } | null> {
        const db = (await this.db());
        const result = db.select({ id: records.id, updatedAt: records.updatedAt })
            .from(records)
            .where(eq(records.folderId, folderId))
            .orderBy(desc(records.updatedAt))
            .limit(1)
            .get() as { id: number; updatedAt: string } | undefined;
        
        return result ? { recordId: result.id, updatedAt: result.updatedAt } : null;
    }
}