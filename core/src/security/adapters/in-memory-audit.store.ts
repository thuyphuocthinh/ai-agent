import { Injectable } from '@nestjs/common';
import { IAuditStore } from '../contracts/audit-store.interface';
import { AuditLogEntry } from '../security.interface';

@Injectable()
export class InMemoryAuditStore implements IAuditStore {
  private readonly logs: AuditLogEntry[] = [];

  async save(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }

  async findByUserId(userId: string): Promise<AuditLogEntry[]> {
    return this.logs.filter((log) => log.userId === userId);
  }

  async findByEntityId(entityId: string): Promise<AuditLogEntry[]> {
    return this.logs.filter((log) => log.entityId === entityId);
  }

  async getRecentLogs(limit = 100): Promise<AuditLogEntry[]> {
    return this.logs.slice(-limit).reverse();
  }
}
