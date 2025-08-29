import { eq, and, desc } from 'drizzle-orm';
import { db } from './drizzle';
import { automationLogs, calls, callEvents, customChains } from './schema';
import type { NewAutomationLog, NewCall, NewCallEvent, Call } from './schema';

export class DatabaseRepository {
  // Automation Logs operations
  async createAutomationLog(data: NewAutomationLog) {
    const [result] = await db.insert(automationLogs).values(data).returning();
    return result;
  }

  async updateAutomationLogStatus(chainRunId: string, status: string, agentResponse?: string) {
    const [result] = await db
      .update(automationLogs)
      .set({
        status,
        agentResponse,
        agentReceivedAt: new Date(),
        isCompleted: status === 'completed',
      })
      .where(eq(automationLogs.uniqueId, chainRunId))
      .returning();
    return result;
  }

  async getAutomationLogByChainRunId(chainRunId: string) {
    const [result] = await db
      .select()
      .from(automationLogs)
      .where(eq(automationLogs.uniqueId, chainRunId))
      .limit(1);
    return result;
  }

  // Calls operations
  async createCall(data: NewCall) {
    const [result] = await db.insert(calls).values(data).returning();
    return result;
  }

  async updateCallStatus(callSid: string, status: string, summary?: any) {
    const updateData: Partial<Call> = {
      status,
      updatedAt: new Date(),
    };
    
    if (summary) {
      updateData.summary = summary;
    }

    const [result] = await db
      .update(calls)
      .set(updateData)
      .where(eq(calls.callSid, callSid))
      .returning();
    return result;
  }

  async updateCallRisk(callSid: string, riskScore: number) {
    const [result] = await db
      .update(calls)
      .set({
        riskLast: riskScore.toString(),
        updatedAt: new Date(),
      })
      .where(eq(calls.callSid, callSid))
      .returning();
    return result;
  }

  async getCallByCallSid(callSid: string) {
    const [result] = await db
      .select()
      .from(calls)
      .where(eq(calls.callSid, callSid))
      .limit(1);
    return result;
  }

  async getCallByChainRunId(chainRunId: string) {
    const [result] = await db
      .select()
      .from(calls)
      .where(eq(calls.chainRunId, chainRunId))
      .limit(1);
    return result;
  }

  // Call Events operations
  async logCallEvent(callId: number, eventType: string, eventData?: any) {
    const [result] = await db
      .insert(callEvents)
      .values({
        callId,
        eventType,
        eventData,
      })
      .returning();
    return result;
  }

  async getCallEvents(callId: number) {
    const results = await db
      .select()
      .from(callEvents)
      .where(eq(callEvents.callId, callId))
      .orderBy(desc(callEvents.timestamp));
    return results;
  }

  // Custom Chains operations
  async createCustomChain(name: string) {
    const [result] = await db
      .insert(customChains)
      .values({ name })
      .returning();
    return result;
  }

  async getCustomChains() {
    const results = await db
      .select()
      .from(customChains)
      .orderBy(desc(customChains.createdAt));
    return results;
  }

  // Health check
  async healthCheck() {
    try {
      const [result] = await db.select().from(automationLogs).limit(1);
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const repo = new DatabaseRepository();

