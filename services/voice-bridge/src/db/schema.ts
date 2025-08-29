import { pgTable, serial, text, boolean, timestamp, jsonb, numeric, index } from 'drizzle-orm/pg-core';

// Core AIGENTS automation logs table
export const automationLogs = pgTable('automation_logs', {
  id: serial('id').primaryKey(),
  chainName: text('chain_name').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull(),
  response: text('response'),
  requestData: jsonb('request_data'),
  uniqueId: text('unique_id'),
  emailResponse: text('email_response'),
  emailReceivedAt: timestamp('email_received_at'),
  agentResponse: text('agent_response'),
  agentName: text('agent_name'),
  agentReceivedAt: timestamp('agent_received_at'),
  webhookPayload: jsonb('webhook_payload'),
  chainType: text('chain_type'),
  isCompleted: boolean('is_completed').default(false),
  ts: timestamp('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Optional custom chains table
export const customChains = pgTable('custom_chains', {
  id: serial('id').primaryKey(),
  name: text('name').unique().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Telephony calls table - maps Twilio Call SID and Realtime session to AIGENTS run
export const calls = pgTable('calls', {
  id: serial('id').primaryKey(),
  chainRunId: text('chain_run_id').notNull(),
  callSid: text('call_sid').unique(),
  patientId: text('patient_id'),
  phone: text('phone'),
  status: text('status').notNull().default('created'), // created|dialing|connected|completed|failed
  callbackUrl: text('callback_url').notNull(),
  context: jsonb('context'), // patient demographic snapshot, objective, etc.
  summary: jsonb('summary'), // final agent summary payload
  riskLast: numeric('risk_last'), // last biomarker risk value
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  chainRunIdx: index('idx_calls_chain_run').on(table.chainRunId),
  callSidIdx: index('idx_calls_call_sid').on(table.callSid),
}));

// Optional: Call session events for detailed logging
export const callEvents = pgTable('call_events', {
  id: serial('id').primaryKey(),
  callId: serial('call_id').references(() => calls.id),
  eventType: text('event_type').notNull(), // 'started', 'connected', 'tool_call', 'biomarker_risk', 'completed', 'failed'
  eventData: jsonb('event_data'),
  timestamp: timestamp('timestamp').defaultNow(),
}, (table) => ({
  callIdIdx: index('idx_call_events_call_id').on(table.callId),
  timestampIdx: index('idx_call_events_timestamp').on(table.timestamp),
}));

// Type exports for use in application code
export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;

export type CallEvent = typeof callEvents.$inferSelect;
export type NewCallEvent = typeof callEvents.$inferInsert;

export type CustomChain = typeof customChains.$inferSelect;
export type NewCustomChain = typeof customChains.$inferInsert;

