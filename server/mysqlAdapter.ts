import type { Pool, PoolConnection } from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PurchaseOrder,
  ProductLine,
  Milestone,
  MaterialItem,
  BaselineRevision,
  POAttachment,
  ProductMasterItem,
  CategoryTemplate,
  RectificationAction,
  AuditLogEntry,
  SystemConfig,
  CancellationRequest
} from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ORG_ID = 'circor-flow-technologies';

/**
 * Safely formats any database date value (string, Date object, or legacy truncated string)
 * into a canonical YYYY-MM-DD calendar string. Never truncates Date.toString()
 * into broken day-names (e.g. "Wed Oct 14").
 */
export function formatDbDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  // If string has format like "Wed Oct 14" without a 4-digit year:
  if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}$/.test(str)) {
    const currentYear = new Date().getFullYear();
    const withYear = `${str} ${currentYear}`;
    const p = new Date(withYear);
    if (!isNaN(p.getTime())) {
      const m = String(p.getMonth() + 1).padStart(2, '0');
      const d = String(p.getDate()).padStart(2, '0');
      return `${currentYear}-${m}-${d}`;
    }
  }
  const parsed = new Date(val);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str.slice(0, 10);
}

/**
 * Ensures the target organization exists in the organizations table.
 */
export async function ensureOrganization(conn: PoolConnection, orgId: string, orgName?: string): Promise<void> {
  const name = orgName || (orgId === DEFAULT_ORG_ID ? 'CIRCOR Flow Technologies' : orgId);
  await conn.query(
    `INSERT INTO organizations (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [orgId, name]
  );
}

/**
 * Initializes the database schema from database/mysql-schema.sql if needed.
 */
export async function initSchema(pool: Pool): Promise<{ success: boolean; executedCount: number }> {
  const schemaPath = path.join(__dirname, '../database/mysql-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`mysql-schema.sql not found at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = sql
    .split(/;\s*[\r\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('SET '));

  const conn = await pool.getConnection();
  let executedCount = 0;
  try {
    for (const stmt of statements) {
      if (stmt.toUpperCase().startsWith('CREATE TABLE')) {
        // Use CREATE TABLE IF NOT EXISTS to prevent errors on restart
        const safeStmt = stmt.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ');
        await conn.query(safeStmt);
        executedCount++;
      } else {
        try {
          await conn.query(stmt);
          executedCount++;
        } catch {
          // Ignore secondary statements that already exist
        }
      }
    }

    await ensureOrganization(conn, DEFAULT_ORG_ID, 'CIRCOR Flow Technologies');
    await ensureOrganization(conn, 'local-development', 'Local Development Org');

    // Safely widen existing tables from CHAR(36) to VARCHAR(128) to prevent ER_DATA_TOO_LONG
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      const tablesToWiden = [
        ['organizations', ['id']],
        ['users', ['id', 'organization_id']],
        ['purchase_orders', ['id', 'organization_id', 'created_by', 'last_updated_by']],
        ['po_attachments', ['id', 'organization_id', 'purchase_order_id', 'uploaded_by']],
        ['product_lines', ['id', 'organization_id', 'purchase_order_id']],
        ['milestones', ['id', 'organization_id', 'product_line_id', 'last_updated_by']],
        ['materials', ['id', 'organization_id', 'product_line_id', 'updated_by']],
        ['baseline_revisions', ['id', 'organization_id', 'purchase_order_id', 'requested_by', 'approved_by']],
        ['baseline_revision_changes', ['id', 'organization_id', 'baseline_revision_id', 'product_line_id']],
        ['product_catalog', ['id', 'organization_id']],
        ['product_catalog_materials', ['id', 'organization_id', 'product_id']],
        ['category_templates', ['id', 'organization_id']],
        ['category_template_milestones', ['id', 'organization_id', 'template_id']],
        ['rectification_actions', ['id', 'organization_id', 'purchase_order_id', 'product_line_id', 'decision_by']],
        ['system_config', ['organization_id']],
        ['audit_logs', ['id', 'organization_id', 'purchase_order_id', 'user_id']],
        ['subdivisions', ['id', 'organization_id', 'milestone_id', 'owner_user_id']],
        ['po_slot_assignments', ['id', 'organization_id', 'purchase_order_id', 'user_id']],
        ['cancellation_requests', ['id', 'organization_id', 'purchase_order_id']]
      ];
      for (const [table, cols] of tablesToWiden) {
        for (const col of cols as string[]) {
          try {
            await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${col}\` VARCHAR(128)`);
          } catch {}
        }
      }
    } catch {
      // Non-fatal if DB user lacks alter permissions
    } finally {
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch {}
    }

    return { success: true, executedCount };
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Purchase Orders & Milestones
// ---------------------------------------------------------------------------

export async function saveOrdersToDb(pool: Pool, orgId: string, orders: PurchaseOrder[]): Promise<void> {
  if (!orders || !Array.isArray(orders)) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const po of orders) {
      if (!po.id || !po.poNumber) continue;

      const poDate = formatDbDate(po.poDate) || new Date().toISOString().slice(0, 10);
      const committedDate = formatDbDate(po.committedDeliveryDate) || poDate;
      const revisedDate = formatDbDate(po.revisedDeliveryDate) || committedDate;
      const actualDeliveryDate = po.actualDeliveryDate ? formatDbDate(po.actualDeliveryDate) : null;
      const bookedAmount = typeof po.bookedAmount === 'number' ? po.bookedAmount : null;

      await conn.query(
        `INSERT INTO purchase_orders (
          id, organization_id, po_number, customer_name, customer_po_ref,
          po_date, booked_amount, contract_review_ref, committed_delivery_date,
          revised_delivery_date, actual_delivery_date, status, is_closed,
          closure_notes, is_cancelled, cancellation_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          customer_name = VALUES(customer_name),
          customer_po_ref = VALUES(customer_po_ref),
          po_date = VALUES(po_date),
          booked_amount = VALUES(booked_amount),
          contract_review_ref = VALUES(contract_review_ref),
          committed_delivery_date = VALUES(committed_delivery_date),
          revised_delivery_date = VALUES(revised_delivery_date),
          actual_delivery_date = VALUES(actual_delivery_date),
          status = VALUES(status),
          is_closed = VALUES(is_closed),
          closure_notes = VALUES(closure_notes),
          is_cancelled = VALUES(is_cancelled),
          cancellation_reason = VALUES(cancellation_reason),
          updated_at = CURRENT_TIMESTAMP`,
        [
          po.id,
          orgId,
          po.poNumber,
          po.customerName || '',
          po.customerPoRef || '',
          poDate,
          bookedAmount,
          po.contractReviewRef || '',
          committedDate,
          revisedDate,
          actualDeliveryDate,
          po.status || 'In Progress',
          Boolean(po.isClosed),
          po.closureNotes || null,
          Boolean(po.isCancelled),
          po.cancellationReason || null
        ]
      );

      // Save Attachments (metadata only — no binary payload in current frontend type)
      if (Array.isArray(po.attachments)) {
        for (const att of po.attachments) {
          if (!att.id) continue;
          await conn.query(
            `INSERT INTO po_attachments (
               id, organization_id, purchase_order_id, file_name, attachment_type, file_size
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               file_name = VALUES(file_name),
               attachment_type = VALUES(attachment_type),
               file_size = VALUES(file_size)`,
            [
              att.id,
              orgId,
              po.id,
              att.name || 'attachment',
              att.type || 'General',
              att.size || ''
            ]
          );
        }
      }


      // Save Product Lines
      if (Array.isArray(po.productLines)) {
        for (const line of po.productLines) {
          if (!line.id) continue;

          await conn.query(
            `INSERT INTO product_lines (
              id, organization_id, purchase_order_id, line_number, product_name,
              category, quantity, design_type, status, overall_variance_days, delay_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_name = VALUES(product_name),
              category = VALUES(category),
              quantity = VALUES(quantity),
              design_type = VALUES(design_type),
              status = VALUES(status),
              overall_variance_days = VALUES(overall_variance_days),
              delay_reason = VALUES(delay_reason)`,
            [
              line.id,
              orgId,
              po.id,
              line.lineNumber || 'LINE-01',
              line.productName || '',
              line.category || 'Valves',
              line.qty || 1,
              line.designType || 'Existing Design',
              line.status || 'Not Started',
              line.overallVarianceDays || 0,
              line.delayReason || null
            ]
          );

          // Save Milestones
          if (Array.isArray(line.milestones)) {
            for (const ms of line.milestones) {
              if (!ms.id || !ms.key) continue;

              const bStart = formatDbDate(ms.committedBaselineStartDate) || poDate;
              const bEnd = formatDbDate(ms.committedBaselineEndDate) || committedDate;
              const fStart = formatDbDate(ms.forecastStartDate) || bStart;
              const fEnd = formatDbDate(ms.forecastEndDate) || bEnd;
              const aStart = ms.actualStartDate ? formatDbDate(ms.actualStartDate) : null;
              const aEnd = ms.actualEndDate ? formatDbDate(ms.actualEndDate) : null;

              await conn.query(
                `INSERT INTO milestones (
                  id, organization_id, product_line_id, milestone_key, milestone_name,
                  stage_order, default_duration_days, committed_baseline_start_date,
                  committed_baseline_end_date, committed_duration_days, actual_start_date,
                  actual_end_date, forecast_start_date, forecast_end_date, variance_days,
                  status, completion_pct, approval_reference, drawing_number, ecn_number,
                  delay_category, delay_owner, delay_reason, doc_ref, backdate_reason,
                  accepted_by, assembly_sub_tabs
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  milestone_name = VALUES(milestone_name),
                  stage_order = VALUES(stage_order),
                  default_duration_days = VALUES(default_duration_days),
                  committed_baseline_start_date = VALUES(committed_baseline_start_date),
                  committed_baseline_end_date = VALUES(committed_baseline_end_date),
                  committed_duration_days = VALUES(committed_duration_days),
                  actual_start_date = VALUES(actual_start_date),
                  actual_end_date = VALUES(actual_end_date),
                  forecast_start_date = VALUES(forecast_start_date),
                  forecast_end_date = VALUES(forecast_end_date),
                  variance_days = VALUES(variance_days),
                  status = VALUES(status),
                  completion_pct = VALUES(completion_pct),
                  approval_reference = VALUES(approval_reference),
                  drawing_number = VALUES(drawing_number),
                  ecn_number = VALUES(ecn_number),
                  delay_category = VALUES(delay_category),
                  delay_owner = VALUES(delay_owner),
                  delay_reason = VALUES(delay_reason),
                  doc_ref = VALUES(doc_ref),
                  backdate_reason = VALUES(backdate_reason),
                  accepted_by = VALUES(accepted_by),
                  assembly_sub_tabs = VALUES(assembly_sub_tabs)`,
                [
                  ms.id,
                  orgId,
                  line.id,
                  ms.key,
                  ms.name || ms.key,
                  ms.stageOrder || 1,
                  ms.defaultDurationDays || 1,
                  bStart,
                  bEnd,
                  ms.committedDurationDays || 1,
                  aStart,
                  aEnd,
                  fStart,
                  fEnd,
                  ms.varianceDays || 0,
                  ms.status || 'Not Started',
                  ms.completionPct || 0,
                  ms.approvalReference || null,
                  ms.drawingNumber || null,
                  ms.ecnNumber || null,
                  ms.delayCategory || null,
                  ms.delayOwner || null,
                  ms.delayReason || null,
                  ms.docRef || null,
                  ms.backdateReason || null,
                  ms.acceptedBy || null,
                  ms.assemblySubTabs ? JSON.stringify(ms.assemblySubTabs) : null
                ]
              );

              // Save Subdivisions
              if (Array.isArray(ms.subdivisions)) {
                for (const sub of ms.subdivisions) {
                  if (!sub.id) continue;
                  await conn.query(
                    `INSERT INTO subdivisions (
                      id, organization_id, milestone_id, title, owner_slot, owner_user_id,
                      owner_label, status, target_start, target_end, actual_start, actual_end,
                      delay_cause, delay_note
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                      title = VALUES(title),
                      owner_slot = VALUES(owner_slot),
                      owner_user_id = VALUES(owner_user_id),
                      owner_label = VALUES(owner_label),
                      status = VALUES(status),
                      target_start = VALUES(target_start),
                      target_end = VALUES(target_end),
                      actual_start = VALUES(actual_start),
                      actual_end = VALUES(actual_end),
                      delay_cause = VALUES(delay_cause),
                      delay_note = VALUES(delay_note)`,
                    [
                      sub.id,
                      orgId,
                      ms.id,
                      sub.title || 'Task',
                      sub.ownerSlot || 'PM',
                      sub.ownerUserId || null,
                      sub.ownerLabel || null,
                      sub.status || 'Not Started',
                      sub.targetStart ? formatDbDate(sub.targetStart) : null,
                      sub.targetEnd ? formatDbDate(sub.targetEnd) : null,
                      sub.actualStart ? formatDbDate(sub.actualStart) : null,
                      sub.actualEnd ? formatDbDate(sub.actualEnd) : null,
                      sub.delayCause || null,
                      sub.delayNote || null
                    ]
                  );
                }
              }
            }
          }

          // Save Materials
          if (Array.isArray(line.materials)) {
            for (const mat of line.materials) {
              if (!mat.id) continue;
              await conn.query(
                `INSERT INTO materials (
                  id, organization_id, product_line_id, item_code, description,
                  quantity, unit, supplier_name, lead_time_days, is_critical_path,
                  ordered_date, expected_date, dispatched_date, received_date,
                  grn_number, inspection_result, inspection_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  description = VALUES(description),
                  quantity = VALUES(quantity),
                  unit = VALUES(unit),
                  supplier_name = VALUES(supplier_name),
                  lead_time_days = VALUES(lead_time_days),
                  is_critical_path = VALUES(is_critical_path),
                  ordered_date = VALUES(ordered_date),
                  expected_date = VALUES(expected_date),
                  dispatched_date = VALUES(dispatched_date),
                  received_date = VALUES(received_date),
                  grn_number = VALUES(grn_number),
                  inspection_result = VALUES(inspection_result),
                  inspection_notes = VALUES(inspection_notes)`,
                [
                  mat.id,
                  orgId,
                  line.id,
                  mat.itemCode || 'ITEM',
                  mat.description || '',
                  mat.qty || 1,
                  mat.unit || 'NOS',
                  mat.supplierName || '',
                  mat.leadTimeDays || 14,
                  Boolean(mat.isCriticalPath),
                  mat.orderedDate ? formatDbDate(mat.orderedDate) : null,
                  mat.expectedDate ? formatDbDate(mat.expectedDate) : null,
                  mat.dispatchedDate ? formatDbDate(mat.dispatchedDate) : null,
                  mat.receivedDate ? formatDbDate(mat.receivedDate) : null,
                  mat.grnNumber || null,
                  mat.inspectionResult || 'Pending',
                  mat.inspectionNotes || null
                ]
              );
            }
          }
        }
      }

      // Save Baseline Revisions + change rows (after product_lines exist for FK resolution)
      if (Array.isArray(po.revisions)) {
        for (const rev of po.revisions) {
          const revId = `${po.id}-rev-${rev.revNumber}`.slice(0, 120);
          await conn.query(
            `INSERT INTO baseline_revisions (
               id, organization_id, purchase_order_id, revision_number, reason,
               document_reference, requested_by, approved_by, approved_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
             ON DUPLICATE KEY UPDATE
               reason = VALUES(reason),
               document_reference = VALUES(document_reference),
               approved_at = VALUES(approved_at)`,
            [
              revId,
              orgId,
              po.id,
              rev.revNumber,
              rev.reason || '',
              rev.docRef || '',
              rev.approvedAt ? new Date(rev.approvedAt) : new Date()
            ]
          );

          if (Array.isArray(rev.changes)) {
            for (const ch of rev.changes) {
              const changeId = `${revId}-${ch.lineId}-${ch.milestoneKey}`.slice(0, 120);
              // Resolve product_line FK; skip orphan change rows rather than failing the order.
              const [lineRows] = await conn.query<any[]>(
                `SELECT id FROM product_lines WHERE id = ? LIMIT 1`,
                [ch.lineId]
              );
              if (!lineRows || lineRows.length === 0) continue;
              await conn.query(
                `INSERT INTO baseline_revision_changes (
                   id, organization_id, baseline_revision_id, product_line_id, milestone_key,
                   old_duration_days, new_duration_days, old_baseline_end_date, new_baseline_end_date
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   old_duration_days = VALUES(old_duration_days),
                   new_duration_days = VALUES(new_duration_days),
                   old_baseline_end_date = VALUES(old_baseline_end_date),
                   new_baseline_end_date = VALUES(new_baseline_end_date)`,
                [
                  changeId,
                  orgId,
                  revId,
                  ch.lineId,
                  ch.milestoneKey,
                  ch.oldDuration ?? 0,
                  ch.newDuration ?? 0,
                  ch.oldBaselineEnd ? formatDbDate(ch.oldBaselineEnd) : poDate,
                  ch.newBaselineEnd ? formatDbDate(ch.newBaselineEnd) : committedDate
                ]
              );
            }
          }
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteOrderFromDb(pool: Pool, orgId: string, orderId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Resolve by id or po_number within the org scope.
    const [rows] = await conn.query<any[]>(
      `SELECT id FROM purchase_orders WHERE organization_id = ? AND (id = ? OR po_number = ?) LIMIT 1`,
      [orgId, orderId, orderId]
    );
    if (!rows || rows.length === 0) {
      await conn.rollback();
      return false;
    }
    const dbId: string = rows[0].id;
    // Explicit deletes; FK cascades cover lines/milestones/materials/attachments/slots/cancellations.
    await conn.query(`DELETE FROM purchase_orders WHERE organization_id = ? AND id = ?`, [orgId, dbId]);
    await conn.commit();
    return true;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback errors; original error is more informative.
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadOrdersFromDb(pool: Pool, orgId: string): Promise<PurchaseOrder[]> {
  const conn = await pool.getConnection();
  try {
    const [poRows] = await conn.query<any[]>(
      `SELECT * FROM purchase_orders WHERE organization_id = ? ORDER BY po_date DESC`,
      [orgId]
    );

    if (!poRows || poRows.length === 0) return [];

    const orders: PurchaseOrder[] = [];

    for (const poRow of poRows) {
      const [lineRows] = await conn.query<any[]>(
        `SELECT * FROM product_lines WHERE purchase_order_id = ? ORDER BY line_number ASC`,
        [poRow.id]
      );

      const productLines: ProductLine[] = [];

      for (const lineRow of lineRows) {
        const [msRows] = await conn.query<any[]>(
          `SELECT * FROM milestones WHERE product_line_id = ? ORDER BY stage_order ASC`,
          [lineRow.id]
        );

        const [matRows] = await conn.query<any[]>(
          `SELECT * FROM materials WHERE product_line_id = ?`,
          [lineRow.id]
        );

        const milestones: Milestone[] = [];
        for (const m of msRows) {
          const [subRows] = await conn.query<any[]>(
            `SELECT * FROM subdivisions WHERE organization_id = ? AND milestone_id = ? ORDER BY created_at ASC`,
            [orgId, m.id]
          );

          milestones.push({
            id: m.id,
            key: m.milestone_key,
            name: m.milestone_name,
            stageOrder: Number(m.stage_order),
            defaultDurationDays: Number(m.default_duration_days),
            committedBaselineStartDate: formatDbDate(m.committed_baseline_start_date),
            committedBaselineEndDate: formatDbDate(m.committed_baseline_end_date),
            currentBaselineEndDate: m.current_baseline_end_date ? formatDbDate(m.current_baseline_end_date) : undefined,
            committedDurationDays: Number(m.committed_duration_days),
            actualStartDate: m.actual_start_date ? formatDbDate(m.actual_start_date) : undefined,
            actualEndDate: m.actual_end_date ? formatDbDate(m.actual_end_date) : undefined,
            forecastStartDate: formatDbDate(m.forecast_start_date) || formatDbDate(m.committed_baseline_start_date),
            forecastEndDate: formatDbDate(m.forecast_end_date) || formatDbDate(m.committed_baseline_end_date),
            varianceDays: Number(m.variance_days || 0),
            status: m.status,
            completionPct: Number(m.completion_pct || 0),
            approvalReference: m.approval_reference || undefined,
            drawingNumber: m.drawing_number || undefined,
            ecnNumber: m.ecn_number || undefined,
            delayCategory: m.delay_category || undefined,
            delayOwner: m.delay_owner || undefined,
            delayReason: m.delay_reason || undefined,
            docRef: m.doc_ref || undefined,
            backdateReason: m.backdate_reason || undefined,
            acceptedBy: m.accepted_by || undefined,
            assemblySubTabs: m.assembly_sub_tabs ? (typeof m.assembly_sub_tabs === 'string' ? JSON.parse(m.assembly_sub_tabs) : m.assembly_sub_tabs) : undefined,
            subdivisions: subRows.length > 0 ? subRows.map(s => ({
              id: s.id,
              title: s.title,
              ownerSlot: s.owner_slot,
              ownerUserId: s.owner_user_id || undefined,
              ownerLabel: s.owner_label || undefined,
              status: s.status,
              targetStart: s.target_start ? formatDbDate(s.target_start) : undefined,
              targetEnd: s.target_end ? formatDbDate(s.target_end) : undefined,
              actualStart: s.actual_start ? formatDbDate(s.actual_start) : undefined,
              actualEnd: s.actual_end ? formatDbDate(s.actual_end) : undefined,
              delayCause: s.delay_cause || undefined,
              delayNote: s.delay_note || undefined
            })) : undefined
          });
        }

        const materials: MaterialItem[] = matRows.map(mat => ({
          id: mat.id,
          itemCode: mat.item_code,
          description: mat.description,
          qty: Number(mat.quantity),
          unit: mat.unit,
          supplierName: mat.supplier_name,
          leadTimeDays: Number(mat.lead_time_days),
          isCriticalPath: Boolean(mat.is_critical_path),
          orderedDate: mat.ordered_date ? formatDbDate(mat.ordered_date) : undefined,
          expectedDate: mat.expected_date ? formatDbDate(mat.expected_date) : undefined,
          dispatchedDate: mat.dispatched_date ? formatDbDate(mat.dispatched_date) : undefined,
          receivedDate: mat.received_date ? formatDbDate(mat.received_date) : undefined,
          grnNumber: mat.grn_number || undefined,
          inspectionResult: mat.inspection_result || 'Pending',
          inspectionNotes: mat.inspection_notes || undefined
        }));

        productLines.push({
          id: lineRow.id,
          lineNumber: lineRow.line_number,
          productName: lineRow.product_name,
          category: lineRow.category,
          qty: Number(lineRow.quantity),
          designType: lineRow.design_type,
          milestones,
          materials,
          overallVarianceDays: Number(lineRow.overall_variance_days || 0),
          status: lineRow.status,
          delayReason: lineRow.delay_reason || undefined
        });
      }

      // Check for associated cancellation request
      let cancellationRequest: any = undefined;
      try {
        const [cancRows] = await conn.query<any[]>(
          `SELECT * FROM cancellation_requests WHERE organization_id = ? AND purchase_order_id = ? ORDER BY requested_at DESC LIMIT 1`,
          [orgId, poRow.id]
        );
        if (cancRows.length > 0) {
          const cr = cancRows[0];
          cancellationRequest = {
            id: cr.id,
            poId: cr.purchase_order_id,
            poNumber: cr.po_number,
            customerName: cr.customer_name,
            requestedBy: cr.requested_by,
            requestedRole: cr.requested_role,
            requestedAt: cr.requested_at ? new Date(cr.requested_at).toISOString() : new Date().toISOString(),
            reason: cr.reason,
            status: cr.status,
            decisionNotes: cr.decision_notes || undefined,
            actionTaken: cr.action_taken || undefined
          };
        }
      } catch {}

      // Load Attachments (metadata) + Baseline Revisions + change rows.
      let attachments: PurchaseOrder['attachments'] = [];
      let revisions: PurchaseOrder['revisions'] = [];
      try {
        const [attRows] = await conn.query<any[]>(
          `SELECT * FROM po_attachments WHERE organization_id = ? AND purchase_order_id = ? ORDER BY uploaded_at ASC`,
          [orgId, poRow.id]
        );
        attachments = attRows.map((a: any) => ({
          id: a.id,
          name: a.file_name,
          type: a.attachment_type,
          size: a.file_size,
          uploadedBy: '',
          uploadedAt: a.uploaded_at ? new Date(a.uploaded_at).toISOString() : new Date().toISOString()
        }));
      } catch {}
      try {
        const [revRows] = await conn.query<any[]>(
          `SELECT * FROM baseline_revisions WHERE organization_id = ? AND purchase_order_id = ? ORDER BY revision_number ASC`,
          [orgId, poRow.id]
        );
        for (const rv of revRows) {
          let changes: PurchaseOrder['revisions'][number]['changes'] = [];
          try {
            const [chRows] = await conn.query<any[]>(
              `SELECT * FROM baseline_revision_changes WHERE organization_id = ? AND baseline_revision_id = ?`,
              [orgId, rv.id]
            );
            changes = chRows.map((c: any) => ({
              lineId: c.product_line_id,
              milestoneKey: c.milestone_key,
              oldDuration: Number(c.old_duration_days),
              newDuration: Number(c.new_duration_days),
              oldBaselineEnd: formatDbDate(c.old_baseline_end_date),
              newBaselineEnd: formatDbDate(c.new_baseline_end_date)
            }));
          } catch {}
          revisions.push({
            revNumber: Number(rv.revision_number),
            requestedBy: '',
            approvedBy: '',
            approvedAt: rv.approved_at ? new Date(rv.approved_at).toISOString() : new Date().toISOString(),
            reason: rv.reason || '',
            docRef: rv.document_reference || '',
            changes
          });
        }
      } catch {}

      orders.push({
        id: poRow.id,
        poNumber: poRow.po_number,
        customerName: poRow.customer_name,
        customerPoRef: poRow.customer_po_ref,
        poDate: formatDbDate(poRow.po_date),
        bookedAmount: poRow.booked_amount !== null ? Number(poRow.booked_amount) : undefined,
        contractReviewRef: poRow.contract_review_ref,
        committedDeliveryDate: formatDbDate(poRow.committed_delivery_date),
        revisedDeliveryDate: formatDbDate(poRow.revised_delivery_date) || formatDbDate(poRow.committed_delivery_date),
        actualDeliveryDate: poRow.actual_delivery_date ? formatDbDate(poRow.actual_delivery_date) : undefined,
        status: poRow.status,
        productLines,
        revisions,
        attachments,
        cancellationRequest,
        createdBy: poRow.created_by || 'Sales',
        createdAt: poRow.created_at ? new Date(poRow.created_at).toISOString() : new Date().toISOString(),
        lastUpdatedBy: poRow.last_updated_by || 'System',
        lastUpdatedAt: poRow.updated_at ? new Date(poRow.updated_at).toISOString() : new Date().toISOString(),
        isClosed: Boolean(poRow.is_closed),
        closureNotes: poRow.closure_notes || undefined,
        isCancelled: Boolean(poRow.is_cancelled),
        cancellationReason: poRow.cancellation_reason || undefined
      });
    }

    return orders;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Product Catalog
// ---------------------------------------------------------------------------

export async function saveProductsToDb(pool: Pool, orgId: string, products: ProductMasterItem[]): Promise<void> {
  if (!products || !Array.isArray(products)) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const prod of products) {
      if (!prod.id || !prod.productCode) continue;

      await conn.query(
        `INSERT INTO product_catalog (
          id, organization_id, product_code, product_name, category, design_type, total_lead_time_days, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_name = VALUES(product_name),
          category = VALUES(category),
          design_type = VALUES(design_type),
          total_lead_time_days = VALUES(total_lead_time_days),
          description = VALUES(description)`,
        [
          prod.id,
          orgId,
          prod.productCode,
          prod.productName,
          prod.category,
          prod.designType,
          prod.totalLeadTimeDays || 30,
          prod.description || null
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadProductsFromDb(pool: Pool, orgId: string): Promise<ProductMasterItem[]> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM product_catalog WHERE organization_id = ? ORDER BY product_name ASC`,
      [orgId]
    );

    return rows.map(r => ({
      id: r.id,
      productCode: r.product_code,
      productName: r.product_name,
      category: r.category,
      designType: r.design_type,
      totalLeadTimeDays: Number(r.total_lead_time_days),
      description: r.description || undefined,
      materials: []
    }));
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export async function saveAuditLogsToDb(pool: Pool, orgId: string, logs: AuditLogEntry[]): Promise<void> {
  if (!logs || !Array.isArray(logs)) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const log of logs) {
      if (!log.id) continue;
      await conn.query(
        `INSERT INTO audit_logs (
          id, organization_id, po_number, product_line, role, action, document_reference, details, backdate_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          details = VALUES(details)`,
        [
          log.id,
          orgId,
          log.poNumber || 'SYSTEM',
          log.productLine || null,
          log.role || 'System',
          log.action || 'UPDATE',
          log.docRef || null,
          log.details || '',
          log.backdateReason || null,
          log.timestamp ? new Date(log.timestamp) : new Date()
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadAuditLogsFromDb(pool: Pool, orgId: string): Promise<AuditLogEntry[]> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 500`,
      [orgId]
    );

    return rows.map(r => ({
      id: r.id,
      timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      user: r.role || 'System',
      role: r.role,
      poNumber: r.po_number,
      productLine: r.product_line || undefined,
      action: r.action,
      docRef: r.document_reference || undefined,
      details: r.details,
      backdateReason: r.backdate_reason || undefined
    }));
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Rectifications
// ---------------------------------------------------------------------------

export async function saveRectificationsToDb(pool: Pool, orgId: string, rects: RectificationAction[]): Promise<void> {
  if (!rects || !Array.isArray(rects)) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const r of rects) {
      if (!r.id) continue;
      await conn.query(
        `INSERT INTO rectification_actions (
          id, organization_id, po_number, product_line_name, milestone_key, milestone_name,
          action_type, title, description, impact_days_saved, suggested_by, suggested_at,
          assigned_to, status, decision_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          decision_notes = VALUES(decision_notes)`,
        [
          r.id,
          orgId,
          r.poNumber || '',
          r.productLineName || '',
          r.milestoneKey || '',
          r.milestoneName || '',
          r.actionType || 'Expedite',
          r.title || '',
          r.description || '',
          r.impactDaysSaved || 0,
          r.suggestedBy || 'System',
          r.suggestedAt ? new Date(r.suggestedAt) : new Date(),
          r.assignedTo || 'PM',
          r.status || 'Pending',
          r.decisionNotes || null
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadRectificationsFromDb(pool: Pool, orgId: string): Promise<RectificationAction[]> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM rectification_actions WHERE organization_id = ? ORDER BY suggested_at DESC`,
      [orgId]
    );

    return rows.map(r => ({
      id: r.id,
      poNumber: r.po_number,
      productLineName: r.product_line_name,
      milestoneKey: r.milestone_key,
      milestoneName: r.milestone_name,
      actionType: r.action_type,
      title: r.title,
      description: r.description,
      impactDaysSaved: Number(r.impact_days_saved),
      suggestedBy: r.suggested_by,
      suggestedAt: r.suggested_at ? new Date(r.suggested_at).toISOString() : new Date().toISOString(),
      assignedTo: r.assigned_to,
      status: r.status,
      decisionNotes: r.decision_notes || undefined
    }));
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// System Config
// ---------------------------------------------------------------------------

export async function saveConfigToDb(pool: Pool, orgId: string, cfg: SystemConfig): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await ensureOrganization(conn, orgId);
    await conn.query(
      `INSERT INTO system_config (
        organization_id, at_risk_threshold_days, delayed_threshold_days, offline_sync_queue, enable_push_notifications
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        at_risk_threshold_days = VALUES(at_risk_threshold_days),
        delayed_threshold_days = VALUES(delayed_threshold_days),
        offline_sync_queue = VALUES(offline_sync_queue),
        enable_push_notifications = VALUES(enable_push_notifications)`,
      [
        orgId,
        cfg.atRiskThresholdDays ?? 3,
        cfg.delayedThresholdDays ?? 7,
        JSON.stringify(cfg.offlineSyncQueue || []),
        Boolean(cfg.enablePushNotifications)
      ]
    );
  } finally {
    conn.release();
  }
}

export async function loadConfigFromDb(pool: Pool, orgId: string): Promise<SystemConfig | null> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM system_config WHERE organization_id = ? LIMIT 1`,
      [orgId]
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      atRiskThresholdDays: Number(r.at_risk_threshold_days),
      delayedThresholdDays: Number(r.delayed_threshold_days),
      offlineSyncQueue: r.offline_sync_queue ? (typeof r.offline_sync_queue === 'string' ? JSON.parse(r.offline_sync_queue) : r.offline_sync_queue) : [],
      enablePushNotifications: Boolean(r.enable_push_notifications)
    };
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Cancellation Requests
// ---------------------------------------------------------------------------

export async function saveCancellationsToDb(pool: Pool, orgId: string, cancellations: CancellationRequest[]): Promise<void> {
  if (!cancellations || !Array.isArray(cancellations)) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const c of cancellations) {
      if (!c.id) continue;
      await conn.query(
        `INSERT INTO cancellation_requests (
          id, organization_id, purchase_order_id, po_number, customer_name,
          requested_by, requested_role, requested_at, reason, status, decision_notes, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          decision_notes = VALUES(decision_notes),
          action_taken = VALUES(action_taken)`,
        [
          c.id,
          orgId,
          c.poId,
          c.poNumber,
          c.customerName,
          c.requestedBy,
          c.requestedRole,
          c.requestedAt ? new Date(c.requestedAt) : new Date(),
          c.reason,
          c.status || 'Pending',
          c.decisionNotes || null,
          c.actionTaken || null
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadCancellationsFromDb(pool: Pool, orgId: string): Promise<CancellationRequest[]> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM cancellation_requests WHERE organization_id = ? ORDER BY requested_at DESC`,
      [orgId]
    );
    return rows.map(r => ({
      id: r.id,
      poId: r.purchase_order_id,
      poNumber: r.po_number,
      customerName: r.customer_name,
      requestedBy: r.requested_by,
      requestedRole: r.requested_role,
      requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : new Date().toISOString(),
      reason: r.reason,
      status: r.status,
      decisionNotes: r.decision_notes || undefined,
      actionTaken: r.action_taken || undefined
    }));
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Category Templates
// ---------------------------------------------------------------------------

export async function saveTemplatesToDb(pool: Pool, orgId: string, templates: CategoryTemplate[]): Promise<void> {
  if (!templates || !Array.isArray(templates)) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const t of templates) {
      if (!t.id) continue;
      await conn.query(
        `INSERT INTO category_templates (id, organization_id, category_name, design_type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           category_name = VALUES(category_name),
           design_type = VALUES(design_type)`,
        [t.id, orgId, t.categoryName, t.designType]
      );

      if (Array.isArray(t.milestoneDurations)) {
        let order = 1;
        for (const md of t.milestoneDurations) {
          const subId = `${t.id}-${md.milestoneKey}`;
          await conn.query(
            `INSERT INTO category_template_milestones (
               id, organization_id, template_id, stage_order, milestone_key, milestone_name, duration_days
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               stage_order = VALUES(stage_order),
               milestone_name = VALUES(milestone_name),
               duration_days = VALUES(duration_days)`,
            [subId, orgId, t.id, order++, md.milestoneKey, md.milestoneName, md.durationDays]
          );
        }
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadTemplatesFromDb(pool: Pool, orgId: string): Promise<CategoryTemplate[]> {
  const conn = await pool.getConnection();
  try {
    const [tRows] = await conn.query<any[]>(
      `SELECT * FROM category_templates WHERE organization_id = ?`,
      [orgId]
    );

    const templates: CategoryTemplate[] = [];
    for (const tr of tRows) {
      const [mRows] = await conn.query<any[]>(
        `SELECT * FROM category_template_milestones WHERE template_id = ? ORDER BY stage_order ASC`,
        [tr.id]
      );

      templates.push({
        id: tr.id,
        categoryName: tr.category_name,
        designType: tr.design_type,
        milestoneDurations: mRows.map(m => ({
          milestoneKey: m.milestone_key,
          milestoneName: m.milestone_name,
          durationDays: Number(m.duration_days)
        }))
      });
    }
    return templates;
  } finally {
    conn.release();
  }
}

