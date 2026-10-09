import type {
  PurchaseOrder,
  ProductLine,
  Milestone,
  MilestoneStatus,
  CategoryTemplate,
  ProductMasterItem,
  DesignType,
  MaterialItem
} from '../types';
import {
  todayLocal,
  isValidDateString,
  formatDate,
  addDays,
  getDaysDifference,
  recalculateProductLine,
  resolveLineMaterials,
  buildTemplateSchedule,
  getOrderDeliveryDate
} from './calculationEngine';

// Standard 14 Stages Metadata
export const STANDARD_STAGES_IMPORT_MAP = [
  { stage: 1, key: 'po_from_customer', name: '1. Customer Purchase Order (PO)', colHeader: 'S1_CustomerPO_Actual', defaultDays: 1 },
  { stage: 2, key: 'pm_baseline', name: '2. Baseline Review & Planning', colHeader: 'S2_PMBaseline_Actual', defaultDays: 3 },
  { stage: 3, key: 'corb_release', name: '3. CORB Release', colHeader: 'S3_CORB_Actual', defaultDays: 2 },
  { stage: 4, key: 'bom_release', name: '4. BOM Release', colHeader: 'S4_BOMRelease_Actual', defaultDays: 4 },
  { stage: 5, key: 'wo_release', name: '5. Work Order Release', colHeader: 'S5_WORelease_Actual', defaultDays: 2 },
  { stage: 6, key: 'sub_supplier_po', name: '6. Sub-Supplier PO', colHeader: 'S6_SubSupplierPO_Actual', defaultDays: 3 },
  { stage: 7, key: 'material_receipt', name: '7. Material Receipt (GRN)', colHeader: 'S7_MaterialReceipt_Actual', defaultDays: 14 },
  { stage: 8, key: 'machining', name: '8. Machining', colHeader: 'S8_Machining_Actual', defaultDays: 14 },
  { stage: 9, key: 'assembly', name: '9. Assembly', colHeader: 'S9_Assembly_Actual', defaultDays: 5 },
  { stage: 10, key: 'fg', name: '10. FG', colHeader: 'S10_FG_Actual', defaultDays: 2 },
  { stage: 11, key: 'customer_inspection', name: '11. Customer Inspection', colHeader: 'S11_Inspection_Actual', defaultDays: 2 },
  { stage: 12, key: 'painting', name: '12. Painting', colHeader: 'S12_Painting_Actual', defaultDays: 2 },
  { stage: 13, key: 'trn', name: '13. TRN', colHeader: 'S13_TRN_Actual', defaultDays: 1 },
  { stage: 14, key: 'shipment', name: '14. Final Shipment & Dispatch', colHeader: 'S14_Shipment_Actual', defaultDays: 5 }
];

export interface ImportPreviewRow {
  rowIndex: number;
  poNumber: string;
  customerName: string;
  lineNumber: string;
  productName: string;
  category: string;
  designType: DesignType;
  qty: number;
  customerPoDate: string;
  contractualDeliveryDate?: string;
  completedStagesCount: number;
  currentActiveStageName: string;
  status: string;
  errors: string[];
  warnings: string[];
}

export interface ImportPreviewResult {
  isValid: boolean;
  totalRows: number;
  totalPOs: number;
  totalProductLines: number;
  errors: string[];
  warnings: string[];
  previewPOs: PurchaseOrder[];
  previewRows: ImportPreviewRow[];
}

/**
 * Normalizes loose date input formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD-Mon-YYYY)
 * into strict ISO calendar string 'YYYY-MM-DD'.
 */
export function normalizeCsvDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const str = raw.trim();
  if (!str) return undefined;

  // Ignore durations, counts, percentages, and non-date numbers (e.g. "5", "7", "14", "100%", "5 days", "1 pcs")
  if (/^\d{1,3}(%|\s*(days?|nos|pcs|weeks?))?$/i.test(str) || str.endsWith('%')) {
    return undefined;
  }
  // Ignore non-date text statuses
  if (/^(shipped|in assembly|pending material|pending|passed|failed|rejected|yes|no|fob|cif|ex works|ex-works|in progress|completed|on time|delayed)$/i.test(str)) {
    return undefined;
  }

  // Already standard ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return isValidDateString(str) ? str : undefined;
  }

  // YYYY/MM/DD or YYYY.MM.DD
  if (/^\d{4}[\/\.]\d{1,2}[\/\.]\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split(/[\/\.]/);
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isValidDateString(iso) ? iso : undefined;
  }

  // DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, DD-Mon-YYYY
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    let [p1, p2, p3] = parts;

    // Support month names (e.g. 15-Aug-2026, 15-Aug-26)
    const monthNames: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    const p2Lower = p2.toLowerCase().slice(0, 3);
    if (monthNames[p2Lower]) {
      const month = monthNames[p2Lower];
      const day = parseInt(p1, 10);
      if (p3.length === 2 && /^\d{2}$/.test(p3)) p3 = `20${p3}`;
      if (p3.length === 4 && !isNaN(day) && day >= 1 && day <= 31) {
        const iso = `${p3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isValidDateString(iso)) return iso;
      }
    }

    if (p3.length === 2 && /^\d{2}$/.test(p3)) p3 = `20${p3}`;
    if (p3.length === 4 && /^\d{4}$/.test(p3)) {
      const num1 = parseInt(p1, 10);
      const num2 = parseInt(p2, 10);
      if (!isNaN(num1) && !isNaN(num2)) {
        let day = num1;
        let month = num2;

        if (num1 <= 12 && num2 > 12) {
          // MM/DD/YYYY
          month = num1;
          day = num2;
        }

        const iso = `${p3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isValidDateString(iso)) return iso;
      }
    }
  }

  // Support Excel numeric serial dates (e.g. 46275 for dates in 2026)
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial > 30000 && serial < 60000) {
      const utcDays = serial - 25569;
      const utcValue = utcDays * 86400 * 1000;
      const dateInfo = new Date(utcValue);
      if (!isNaN(dateInfo.getTime())) {
        return formatDate(dateInfo);
      }
    }
  }

  return undefined;
}

/**
 * Parses raw CSV content adhering to RFC 4180 (handling quoted values, escaped commas, newlines).
 */
export function parseCsvToMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (currentVal.length === 0 && !inQuotes) {
        // Opening quote at start of cell
        inQuotes = true;
      } else if (inQuotes && nextChar === '"') {
        // Escaped double quote ("") inside quoted cell
        currentVal += '"';
        i++;
      } else if (inQuotes) {
        // Closing quote
        inQuotes = false;
      } else {
        // Loose literal quote inside cell text (e.g. 4" valve)
        currentVal += '"';
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n in CRLF
      }
      currentRow.push(currentVal.trim());
      currentVal = '';
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentVal += char;
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Escapes a cell value strictly according to CSV RFC 4180 rules.
 */
function escapeCsvCell(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Generates the official template CSV content with exact, high-value columns and realistic examples.
 */
export function generateCsvTemplate(): string {
  const headers = [
    'PO Number',
    'Customer Name',
    'Customer PO Ref',
    'Customer PO Date',
    'Contractual Delivery Date',
    'Product Name',
    'Design Type',
    'Quantity',
    'S1_CustomerPO_Actual',
    'S2_PMBaseline_Actual',
    'S3_CORB_Actual',
    'S4_BOMRelease_Actual',
    'S5_WORelease_Actual',
    'S6_SubSupplierPO_Actual',
    'S7_MaterialOrderDate',
    'S7_MaterialExpectedDate',
    'S7_MaterialReceipt_Actual',
    'S7_InspectionResult',
    'S8_Machining_Actual',
    'S9_Assembly_Actual',
    'S10_FG_Actual',
    'S11_Inspection_Actual',
    'S12_Painting_Actual',
    'S13_TRN_Actual',
    'S14_Shipment_Actual'
  ];

  const sampleRows = [
    // Multi-line in-flight Existing Design order (active at Stage 8 - Machining, 42-day standard flow)
    [
      'PO-2026-801',
      'Saudi Aramco',
      'ARAMCO-PO-9901',
      '2026-09-10',
      '2026-11-20',
      'CFT-HV-100 Gate Valve 2 inch 600#',
      'Existing Design',
      '4',
      '2026-09-10',
      '2026-09-13',
      '2026-09-15',
      '2026-09-19',
      '2026-09-21',
      '2026-09-24',
      '2026-09-24',
      '2026-10-08',
      '2026-10-06',
      'Passed',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    [
      'PO-2026-801',
      'Saudi Aramco',
      'ARAMCO-PO-9901',
      '2026-09-10',
      '2026-11-20',
      'CFT-HV-200 Gate Valve 3 inch 900#',
      'Existing Design',
      '2',
      '2026-09-10',
      '2026-09-13',
      '2026-09-15',
      '2026-09-19',
      '2026-09-21',
      '2026-09-24',
      '2026-09-24',
      '2026-10-08',
      '2026-10-06',
      'Passed',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    // New Design custom engineered order (active at Stage 3 - CORB Release, 90-day baseline flow)
    [
      'PO-2026-802',
      'ExxonMobil Upstream',
      'EXXON-PROJ-442',
      '2026-09-28',
      '2027-01-15',
      'Custom Engineered 4 inch Class 1500 Subsea Choke Valve',
      'New Design',
      '6',
      '2026-09-28',
      '2026-10-05',
      '',
      '',
      '',
      '',
      '2026-10-05',
      '2026-11-04',
      '',
      'Pending',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    // Completed order with all 14 stages recorded (shipped recently)
    [
      'PO-2026-803',
      'Shell LNG Global',
      'SHELL-2026-019',
      '2026-08-01',
      '2026-10-15',
      'CFT-EMF-100 Electromagnetic Flowmeter DN50',
      'Existing Design',
      '8',
      '2026-08-01',
      '2026-08-04',
      '2026-08-06',
      '2026-08-10',
      '2026-08-12',
      '2026-08-15',
      '2026-08-15',
      '2026-08-29',
      '2026-08-30',
      'Passed',
      '2026-09-15',
      '2026-09-20',
      '2026-09-23',
      '2026-09-26',
      '2026-09-29',
      '2026-10-02',
      '2026-10-06'
    ]
  ];

  const lines = [
    headers.join(','),
    ...sampleRows.map(row => row.map(v => escapeCsvCell(v)).join(','))
  ];

  return lines.join('\r\n');
}

/**
 * Triggers a browser download of the sample CSV template.
 */
export function downloadCsvTemplate(): void {
  const content = generateCsvTemplate();
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'Circor_Bulk_Orders_Template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Header column aliases dictionary for forgiving and user-friendly imports.
 */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Main parser and validator function for CSV imports.
 */
export function parseAndValidateCsv(
  csvContent: string,
  existingPOs: PurchaseOrder[],
  templates: CategoryTemplate[],
  products: ProductMasterItem[],
  activeRole: string = 'Project Management'
): ImportPreviewResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const todayStr = todayLocal();

  if (!csvContent || !csvContent.trim()) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: ['The uploaded CSV file is empty. Please provide valid spreadsheet data.'],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  const matrix = parseCsvToMatrix(csvContent);
  if (matrix.length < 2) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: ['The CSV must contain a header row and at least one data row.'],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  let startDataRow = 1;
  let rawHeaders = matrix[0];

  // Check if Row 1 & Row 2 form a 2-tier merged header (like Book2.xlsx tracker)
  const is2TierHeader = matrix.length >= 2 && (
    matrix[0].some(c => /Mini-BOM|PO - Long Leads|Change Requests|Material Receipts/i.test(c.trim())) ||
    (matrix[1] && matrix[1].some(c => /Project No|Scope|COTD|CORB Release Date/i.test(c.trim())))
  );

  if (is2TierHeader) {
    startDataRow = 2;
    let currentCategory = '';
    rawHeaders = matrix[1].map((subHeader, colIdx) => {
      const parentHeader = matrix[0][colIdx]?.trim() || '';
      if (parentHeader) {
        currentCategory = parentHeader;
      }
      const cleanSub = subHeader?.trim() || '';
      if (currentCategory && ['Planned', 'Actual', 'Delay'].includes(cleanSub)) {
        return `${currentCategory} ${cleanSub}`.trim();
      }
      return cleanSub || currentCategory;
    });
  }

  // Verify that there are data rows beyond the headers
  const actualDataRows = matrix.slice(startDataRow).filter(r => r.some(c => c.trim().length > 0));
  if (actualDataRows.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: [
        is2TierHeader
          ? 'No order rows found. The uploaded spreadsheet contains valid headers (Rows 1 & 2), but has no order rows filled in below Row 2. Please enter your order data (PO NO, Customer Name, Scope, PO Date, Promised Date) starting from Row 3 and re-upload.'
          : 'The CSV must contain a header row and at least one data row.'
      ],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  const headerMap: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    headerMap[normalizeHeader(h)] = idx;
  });

  const getColIdx = (possibleNames: string[]): number => {
    for (const name of possibleNames) {
      const norm = normalizeHeader(name);
      if (headerMap[norm] !== undefined) return headerMap[norm];
    }
    return -1;
  };

  // Header Indices
  const poNumIdx = getColIdx(['PO Number', 'PONumber', 'po_number', 'PO_No', 'PO NO', 'Project No', 'Project Number', 'Order No', 'Order Number']);
  const custNameIdx = getColIdx(['Customer Name', 'Customer', 'Client Name', 'Client']);
  const poRefIdx = getColIdx(['Customer PO Ref', 'PO Reference', 'Customer Ref', 'PO Ref', 'PO NO']);
  const poDateIdx = getColIdx(['Customer PO Date', 'PO Date', 'Order Date', 'Date']);
  const delDateIdx = getColIdx(['Contractual Delivery Date', 'Delivery Date', 'Target Delivery Date', 'Promised Date', 'COTD']);
  const prodNameIdx = getColIdx(['Product Name', 'Product', 'Product Line', 'Scope', 'Item Description', 'Description', 'Valve Type']);
  const categoryIdx = getColIdx(['Category', 'Product Category']);
  const designTypeIdx = getColIdx(['Design Type', 'Design']);
  const qtyIdx = getColIdx(['Quantity', 'Qty', 'Quantity (Nos)', 'Nos']);

  // Stage 7 Raw Material Specific Column Indices
  const matOrderDateIdx = getColIdx(['S7_MaterialOrderDate', 'S7_MaterialOrderedDate', 'S7_MaterialOrder_Actual', 'Material Order Date', 'Material Ordered Date', 'S7_OrderDate']);
  const matExpectedDateIdx = getColIdx(['S7_MaterialExpectedDate', 'S7_MaterialExpected_Actual', 'Material Expected Date', 'Material Delivery Date', 'S7_ExpectedDate']);
  const matInspectionIdx = getColIdx(['S7_InspectionResult', 'Inspection Result', 'Incoming Inspection', 'S7_Inspection']);
  const remarksIdx = getColIdx(['Remarks', 'Remark', 'Delay Reason', 'Notes', 'Work Notes', 'Comments', 'delay_reason']);

  // Milestone Date Columns for all 14 Standard Stages
  const stageColIndices = STANDARD_STAGES_IMPORT_MAP.map(s => {
    const exactCol = getColIdx([
      s.colHeader,
      `Stage_${s.stage}_Actual`,
      `Stage${s.stage}_Actual`,
      `S${s.stage}_Actual`,
      `S${s.stage}`,
      s.key,
      s.name,
      // Comprehensive 14-Stage Specific Aliases (in strict priority order)
      ...(s.stage === 1 ? ['Customer PO Date', 'Customer PO Intake', 'PO Intake', 'PO Date', 'Order Date', 'Date'] : []),
      ...(s.stage === 2 ? ['PM Baseline Actual', 'PM Baseline Date', 'PM Baseline', 'Baseline Review & Planning', 'Baseline Date', 'PM Baseline Schedule'] : []),
      ...(s.stage === 3 ? ['CORB Release Date', 'CORB Release Actual', 'CORB Release', 'CORB Open Points Closure', 'CORB Actual', 'CORB'] : []),
      ...(s.stage === 4 ? ['Mini-BOM Actual', 'Mini-BOM', 'BOM Release Date', 'BOM Release Actual', 'BOM Actual', 'BOM Release', 'BOM'] : []),
      ...(s.stage === 5 ? ['Work Order Release Actual', 'WO Release Actual', 'Work Order Release', 'WO Release Date', 'WO Release', 'Work Order', 'WO Actual', 'WO'] : []),
      ...(s.stage === 6 ? ['PO - Long Leads Actual', 'Long Lead PO Actual', 'PO - Long Leads', 'Sub-Supplier PO Actual', 'Sub Supplier PO Actual', 'PO Actual', 'Sub-Supplier PO Date', 'Sub Supplier PO Date', 'Sub-Supplier PO', 'Sub Supplier PO'] : []),
      ...(s.stage === 7 ? ['Material Receipts Actual', 'Material Receipt Actual', 'Material Receipt Date', 'Mat\'l receipt Actual', 'Material Receipt (GRN)', 'Material Receipt', 'Material Receipts', 'GRN Actual', 'GRN Date', 'GRN'] : []),
      ...(s.stage === 8 ? ['Machining Actual', 'Machining Date', 'Machining Complete', 'Machining'] : []),
      ...(s.stage === 9 ? ['Assembly Actual', 'Assembly Date', 'Assembly Complete', 'Assembly'] : []),
      ...(s.stage === 10 ? ['FG Actual', 'Finished Goods Actual', 'FG Date', 'Finished Goods', 'FG Complete', 'FG'] : []),
      ...(s.stage === 11 ? ['Customer Inspection Actual', 'Customer Inspection Date', 'Inspection Actual', 'Customer Inspection', 'Inspection Complete', 'Inspection'] : []),
      ...(s.stage === 12 ? ['Painting Actual', 'Painting Date', 'Painting Complete', 'Painting'] : []),
      ...(s.stage === 13 ? ['TRN Actual', 'TRN Date', 'Test Report Notice', 'TRN Complete', 'TRN'] : []),
      ...(s.stage === 14 ? ['Packing & Dispatch Actual', 'Packing & Dispatch Date', 'Packing / Shipping Actual', 'Final Shipment & Dispatch Actual', 'Shipment Actual', 'Dispatch Actual', 'Packing & Dispatch', 'Shipment Date', 'Dispatch Date'] : [])
    ]);
    return {
      stage: s.stage,
      key: s.key,
      name: s.name,
      colIdx: exactCol,
      defaultDays: s.defaultDays
    };
  });

  if (poNumIdx === -1) errors.push('Missing required column header: "PO Number" (or "PO NO" / "Project No")');
  if (custNameIdx === -1) errors.push('Missing required column header: "Customer Name"');
  if (poDateIdx === -1) errors.push('Missing required column header: "Customer PO Date" (or "PO Date")');
  if (delDateIdx === -1) errors.push('Missing required column header: "Contractual Delivery Date" (or "Promised Date" / "COTD")');
  if (prodNameIdx === -1) errors.push('Missing required column header: "Product Name" (or "Scope")');

  if (errors.length > 0) {
    return {
      isValid: false,
      totalRows: matrix.length - 1,
      totalPOs: 0,
      totalProductLines: 0,
      errors,
      warnings,
      previewPOs: [],
      previewRows: []
    };
  }

  // Intermediate Raw Data Structure grouped by PO Number
  interface RawLineItem {
    rowIndex: number;
    tagNumber: string;
    productName: string;
    category: string;
    qty: number;
    designType: DesignType;
    stageActualDates: Record<string, string>; // stageKey -> YYYY-MM-DD
    matOrderDate?: string;
    matExpectedDate?: string;
    matReceivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    remarks?: string;
    errors: string[];
    warnings: string[];
  }

  interface RawPOGroup {
    poNumber: string;
    customerName: string;
    customerPoRef: string;
    poDate: string;
    deliveryDate?: string;
    lines: RawLineItem[];
  }

  // Pre-index existing POs and catalog items for O(1) performance with 500+ orders
  const existingPoSet = new Set(existingPOs.map(p => p.poNumber.trim().toLowerCase()));

  const poGroups: Map<string, RawPOGroup> = new Map();
  const previewRows: ImportPreviewRow[] = [];

  for (let r = startDataRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (row.length === 0 || row.every(c => !c.trim())) continue;

    const rowNum = r + 1;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    const poNumber = (poNumIdx !== -1 ? row[poNumIdx] : '').trim();
    const customerName = (custNameIdx !== -1 ? row[custNameIdx] : '').trim();
    const customerPoRef = poRefIdx !== -1 ? row[poRefIdx]?.trim() : '';
    const rawPoDate = poDateIdx !== -1 ? row[poDateIdx] : '';
    const poDate = normalizeCsvDate(rawPoDate);
    const rawProdName = prodNameIdx !== -1 ? row[prodNameIdx]?.trim() : '';
    const productName = rawProdName;
    const rawCategory = categoryIdx !== -1 ? row[categoryIdx]?.trim() : '';
    const category = rawCategory || 'High-Pressure Control Valves';
    const rawQty = qtyIdx !== -1 ? row[qtyIdx] : '';
    const parsedQty = parseInt(rawQty, 10);
    const qty = (!rawQty || isNaN(parsedQty) || parsedQty < 1) ? 1 : parsedQty;
    const rawDesign = designTypeIdx !== -1 ? row[designTypeIdx]?.trim() : '';
    const designType: DesignType = /new/i.test(rawDesign) ? 'New Design' : 'Existing Design';
    const rawDelDate = delDateIdx !== -1 ? row[delDateIdx] : '';
    const deliveryDate = normalizeCsvDate(rawDelDate);

    // Stage 7 Procurement Columns (Only 3 Dates + Inspection Result)
    const rawMatOrderDate = matOrderDateIdx !== -1 ? row[matOrderDateIdx]?.trim() : '';
    const matOrderDate = normalizeCsvDate(rawMatOrderDate);
    const rawMatExpectedDate = matExpectedDateIdx !== -1 ? row[matExpectedDateIdx]?.trim() : '';
    const matExpectedDate = normalizeCsvDate(rawMatExpectedDate);
    const rawInspection = matInspectionIdx !== -1 ? row[matInspectionIdx]?.trim() : '';
    const parsedInspection: 'Passed' | 'Rejected' | 'Pending' =
      /^pass/i.test(rawInspection) ? 'Passed' :
      /^rej/i.test(rawInspection) ? 'Rejected' :
      /^pend/i.test(rawInspection) ? 'Pending' :
      'Passed';

    const rawRemarks = remarksIdx !== -1 ? row[remarksIdx]?.trim() : '';

    if (!poNumber) {
      rowErrors.push(`Row #${rowNum}: Missing PO Number.`);
    }

    if (!customerName) {
      rowErrors.push(`Row #${rowNum}: Missing Customer Name.`);
    }

    if (!rawPoDate) {
      rowErrors.push(`Row #${rowNum}: Missing Customer PO Date.`);
    } else if (!poDate) {
      rowErrors.push(`Row #${rowNum}: Invalid Customer PO Date "${rawPoDate}". Expected valid date (e.g. YYYY-MM-DD or DD/MM/YYYY).`);
    }

    if (!rawDelDate || !rawDelDate.trim()) {
      rowErrors.push(`Row #${rowNum}: Missing Contractual Delivery Date.`);
    } else if (!deliveryDate) {
      rowErrors.push(`Row #${rowNum}: Invalid Contractual Delivery Date "${rawDelDate}". Expected valid date (e.g. YYYY-MM-DD or DD/MM/YYYY).`);
    } else if (poDate && deliveryDate < poDate) {
      rowErrors.push(`Row #${rowNum}: Contractual Delivery Date (${deliveryDate}) cannot be earlier than Customer PO Date (${poDate}).`);
    }

    if (!rawProdName) {
      rowErrors.push(`Row #${rowNum}: Missing Product Name.`);
    }

    if (rawQty && (isNaN(parsedQty) || parsedQty < 1)) {
      rowErrors.push(`Row #${rowNum}: Invalid Quantity "${rawQty}". Must be a positive integer.`);
    }

    // Check if PO exists in current database (O(1) fast lookup)
    const poAlreadyExists = existingPoSet.has(poNumber.toLowerCase());
    if (poAlreadyExists) {
      rowWarnings.push(`PO "${poNumber}" already exists in the system. Importing will create an updated entry with generated suffix.`);
    }

    // Parse milestone actual dates
    const stageActualDates: Record<string, string> = {};
    let completedCount = 0;
    let lastActualDate: string | undefined = poDate || todayStr;

    stageColIndices.forEach(stageDef => {
      if (stageDef.colIdx !== -1 && row[stageDef.colIdx]) {
        const rawDate = row[stageDef.colIdx].trim();
        if (rawDate && rawDate !== '0' && rawDate !== '-' && rawDate !== 'N/A' && rawDate !== 'NA' && rawDate !== 'null' && rawDate !== 'undefined') {
          const parsed = normalizeCsvDate(rawDate);
          if (parsed) {
            // Check chronological sanity
            if (lastActualDate && parsed < lastActualDate) {
              rowWarnings.push(`Row #${rowNum}: ${stageDef.name} actual date (${parsed}) is earlier than previous milestone date (${lastActualDate}).`);
            }
            stageActualDates[stageDef.key] = parsed;
            completedCount++;
            lastActualDate = parsed;
          } else if (rawDate.length > 3 && !/^\d+$/.test(rawDate) && !/^(shipped|in assembly|pending|passed|failed|rejected|yes|no|fob|cif)$/i.test(rawDate)) {
            rowWarnings.push(`Row #${rowNum}: Unrecognized date format for ${stageDef.name}: "${rawDate}".`);
          }
        }
      }
    });

    // Ensure Stage 1 always has actual date = poDate if not explicitly given
    if (!stageActualDates['po_from_customer'] && poDate) {
      stageActualDates['po_from_customer'] = poDate;
    }

    // Determine highest completed stage index and calculate accurate bridged completion count & active stage
    let maxCompletedIndex = -1;
    stageColIndices.forEach((sDef, idx) => {
      if (stageActualDates[sDef.key]) {
        maxCompletedIndex = idx;
      }
    });

    const effectiveCompletedCount = maxCompletedIndex >= 0 ? maxCompletedIndex + 1 : (poDate ? 1 : 0);

    let currentActiveStageName = '1. Customer Purchase Order (PO)';
    if (effectiveCompletedCount === 14) {
      currentActiveStageName = '14. Final Shipment & Dispatch (Completed)';
    } else if (maxCompletedIndex >= 0 && maxCompletedIndex < 13) {
      currentActiveStageName = STANDARD_STAGES_IMPORT_MAP[maxCompletedIndex + 1].name;
    } else if (poDate) {
      currentActiveStageName = STANDARD_STAGES_IMPORT_MAP[1].name;
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    const previewRow: ImportPreviewRow = {
      rowIndex: rowNum,
      poNumber,
      customerName,
      lineNumber: `LINE-${String(r).padStart(2, '0')}`,
      productName,
      category,
      designType,
      qty,
      customerPoDate: poDate || rawPoDate,
      contractualDeliveryDate: deliveryDate,
      completedStagesCount: effectiveCompletedCount,
      currentActiveStageName,
      status: effectiveCompletedCount === 14 ? 'Completed' : (effectiveCompletedCount > 1 ? 'In Progress' : 'Baseline Pending'),
      errors: rowErrors,
      warnings: rowWarnings
    };
    previewRows.push(previewRow);

    if (poNumber && poDate) {
      if (!poGroups.has(poNumber)) {
        poGroups.set(poNumber, {
          poNumber,
          customerName,
          customerPoRef: customerPoRef || `PO-REF-${poNumber}`,
          poDate,
          deliveryDate,
          lines: []
        });
      }
      poGroups.get(poNumber)!.lines.push({
        rowIndex: rowNum,
        tagNumber: `LINE-${String(poGroups.get(poNumber)!.lines.length + 1).padStart(2, '0')}`,
        productName,
        category,
        qty,
        designType,
        stageActualDates,
        matOrderDate: matOrderDate || undefined,
        matExpectedDate: matExpectedDate || undefined,
        matReceivedDate: stageActualDates['material_receipt'] || undefined,
        inspectionResult: rawInspection ? parsedInspection : (stageActualDates['material_receipt'] ? 'Passed' : 'Pending'),
        remarks: rawRemarks || undefined,
        errors: rowErrors,
        warnings: rowWarnings
      });
    }
  }

  // Convert raw PO Groups into full typed PurchaseOrder[]
  const previewPOs: PurchaseOrder[] = [];

  poGroups.forEach((group, poNum) => {
    const poId = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const effectivePoDate = group.poDate;

    const productLines: ProductLine[] = group.lines.map((rawLine, lineIdx) => {
      const lineId = `line-${poId}-${lineIdx + 1}`;
      const lineNum = `LINE-${String(lineIdx + 1).padStart(2, '0')}`;
      const designType = rawLine.designType;

      // Find matching catalog or category template
      const catalogItem = products.find(p => 
        p.productCode?.toLowerCase() === rawLine.productName.toLowerCase() ||
        p.productName.toLowerCase() === rawLine.productName.toLowerCase() ||
        p.productName.toLowerCase().includes(rawLine.productName.toLowerCase()) ||
        rawLine.productName.toLowerCase().includes(p.productName.toLowerCase())
      );
      const tmpl = templates.find(t => t.categoryName.toLowerCase() === rawLine.category.toLowerCase() && t.designType === designType)
        || templates.find(t => t.designType === designType)
        || templates[0];

      // Build standard materials (or default critical-path material based on design type)
      let lineMaterials: MaterialItem[] = resolveLineMaterials({
        catalogItem,
        qty: rawLine.qty,
        lineId
      });

      const isNew = designType === 'New Design';
      const defaultLeadTime = isNew ? 30 : 14;

      const effectiveMatOrderDate = rawLine.matOrderDate || rawLine.stageActualDates['sub_supplier_po'] || rawLine.stageActualDates['wo_release'];
      const effectiveMatExpectedDate = rawLine.matExpectedDate || (effectiveMatOrderDate ? addDays(effectiveMatOrderDate, defaultLeadTime) : undefined);
      const effectiveMatReceivedDate = rawLine.stageActualDates['material_receipt'] || rawLine.matReceivedDate;
      const effectiveInspectionResult = rawLine.inspectionResult || (effectiveMatReceivedDate ? 'Passed' : 'Pending');

      if (lineMaterials.length === 0) {
        lineMaterials = [
          {
            id: `mat-${lineId}-1`,
            itemCode: isNew ? 'MAT-RAW-FORGING-NEW' : 'MAT-RAW-CASTING-STD',
            description: isNew ? 'Custom High-Grade Forging / Cast Ingot' : 'Standard Valve Body Casting Material',
            qty: rawLine.qty || 1,
            unit: 'Pcs',
            supplierName: isNew ? 'Specialty Forgings Inc.' : 'Sandvik Precision Castings',
            leadTimeDays: defaultLeadTime,
            isCriticalPath: true,
            orderedDate: effectiveMatOrderDate,
            expectedDate: effectiveMatExpectedDate,
            receivedDate: effectiveMatReceivedDate,
            inspectionResult: effectiveInspectionResult
          }
        ];
      } else {
        lineMaterials = lineMaterials.map(m => ({
          ...m,
          orderedDate: m.orderedDate || effectiveMatOrderDate,
          expectedDate: m.expectedDate || effectiveMatExpectedDate || (effectiveMatOrderDate ? addDays(effectiveMatOrderDate, m.leadTimeDays || defaultLeadTime) : undefined),
          receivedDate: m.receivedDate || (m.isCriticalPath ? effectiveMatReceivedDate : undefined),
          inspectionResult: m.inspectionResult || (effectiveMatReceivedDate ? 'Passed' : m.inspectionResult || 'Pending')
        }));
      }

      // Build baseline schedule starting at effectivePoDate aligned with contractual delivery date
      const baseMilestones = buildTemplateSchedule({
        template: tmpl,
        designType,
        materials: lineMaterials,
        startDate: effectivePoDate,
        lineId,
        targetEndDate: group.deliveryDate
      });

      // Determine the highest milestone index that has an explicit actual completion date
      let maxCompletedIndex = -1;
      baseMilestones.forEach((m, idx) => {
        if (rawLine.stageActualDates[m.key]) {
          maxCompletedIndex = idx;
        }
      });

      // Apply historical completion dates, bridge omitted stages, and activate the real live stage
      let foundFirstPending = false;
      let runningChainDate = effectivePoDate;

      const configuredMilestones: Milestone[] = baseMilestones.map((m, mIdx) => {
        const actualEnd = rawLine.stageActualDates[m.key];
        const isPredecessorOfCompleted = mIdx < maxCompletedIndex;

        let delayReason = m.delayReason;
        let delayCategory = m.delayCategory;

        if (actualEnd) {
          // Explicitly completed milestone
          const actualStart = (m.key === 'material_receipt' && effectiveMatOrderDate)
            ? effectiveMatOrderDate
            : (runningChainDate <= actualEnd ? runningChainDate : actualEnd);
          runningChainDate = actualEnd;

          if (m.committedBaselineEndDate && actualEnd > m.committedBaselineEndDate) {
            const diff = getDaysDifference(m.committedBaselineEndDate, actualEnd);
            if (diff > 0) {
              delayReason = rawLine.remarks || `Completed with +${diff}d schedule variance`;
              delayCategory = (m.key === 'sub_supplier_po' || m.key === 'material_receipt')
                ? 'Supplier'
                : (m.key === 'corb_release' || m.key === 'bom_release')
                  ? 'Customer'
                  : 'Production';
            }
          }

          return {
            ...m,
            actualStartDate: actualStart,
            actualEndDate: actualEnd,
            forecastStartDate: actualStart,
            forecastEndDate: actualEnd,
            status: 'Completed' as MilestoneStatus,
            completionPct: 100,
            delayReason,
            delayCategory,
            docRef: m.key === 'po_from_customer' ? 'PO-INTAKE' : 'LEGACY-IMPORT'
          };
        } else if (isPredecessorOfCompleted) {
          // Omitted intermediate milestone in spreadsheet (e.g. Stage 2 PM Review or Stage 5 WO Release)
          const actualStart = runningChainDate;
          const actualEnd = runningChainDate; // seamless handover

          return {
            ...m,
            actualStartDate: actualStart,
            actualEndDate: actualEnd,
            forecastStartDate: actualStart,
            forecastEndDate: actualEnd,
            status: 'Completed' as MilestoneStatus,
            completionPct: 100,
            docRef: 'AUTO-BRIDGED'
          };
        } else if (m.key === 'material_receipt' && effectiveMatOrderDate && !actualEnd) {
          // Stage 7 actively waiting for material arrival
          foundFirstPending = true;
          const stageStart = effectiveMatOrderDate;
          const stageForecastEnd = effectiveMatExpectedDate || addDays(stageStart, m.committedDurationDays);
          runningChainDate = stageForecastEnd;

          if (m.committedBaselineEndDate && stageForecastEnd > m.committedBaselineEndDate) {
            const diff = getDaysDifference(m.committedBaselineEndDate, stageForecastEnd);
            delayReason = rawLine.remarks || `Material arrival forecast with +${diff}d delay`;
            delayCategory = 'Supplier';
          }

          return {
            ...m,
            actualStartDate: stageStart,
            forecastStartDate: stageStart,
            forecastEndDate: stageForecastEnd,
            status: 'In Progress' as MilestoneStatus,
            completionPct: 50,
            delayReason,
            delayCategory
          };
        } else if (!foundFirstPending && mIdx > maxCompletedIndex) {
          // First active/in-progress milestone after all completed stages
          foundFirstPending = true;
          const stageStart = runningChainDate || todayStr;
          const stageForecastEnd = addDays(stageStart, m.committedDurationDays);
          runningChainDate = stageForecastEnd;

          if (m.committedBaselineEndDate && stageForecastEnd > m.committedBaselineEndDate) {
            const diff = getDaysDifference(m.committedBaselineEndDate, stageForecastEnd);
            delayReason = rawLine.remarks || `In-progress milestone with +${diff}d forecast delay`;
            delayCategory = 'Production';
          }

          return {
            ...m,
            actualStartDate: stageStart,
            forecastStartDate: stageStart,
            forecastEndDate: stageForecastEnd,
            status: 'In Progress' as MilestoneStatus,
            completionPct: 25,
            delayReason,
            delayCategory
          };
        } else {
          // Subsequent future pending stages
          const stageStart = runningChainDate;
          const stageForecastEnd = addDays(stageStart, m.committedDurationDays);
          runningChainDate = stageForecastEnd;

          return {
            ...m,
            forecastStartDate: stageStart,
            forecastEndDate: stageForecastEnd,
            status: 'Not Started' as MilestoneStatus,
            completionPct: 0
          };
        }
      });

      const rawProductLine: ProductLine = {
        id: lineId,
        lineNumber: lineNum,
        productName: rawLine.productName || 'Industrial Valve Line Item',
        category: rawLine.category || 'High-Pressure Control Valves',
        qty: rawLine.qty,
        designType,
        milestones: configuredMilestones,
        materials: lineMaterials,
        overallVarianceDays: 0,
        status: 'In Progress'
      };

      // Run calculation engine to normalize and recalculate all dates & variances
      return recalculateProductLine(rawProductLine, todayStr);
    });

    // Derive PO dates
    const maxLineVariance = Math.max(...productLines.map(l => l.overallVarianceDays || 0), 0);
    const calculatedDeliveryDate = getOrderDeliveryDate(productLines, effectivePoDate);
    const poDeliveryDate = group.deliveryDate && isValidDateString(group.deliveryDate)
      ? group.deliveryDate
      : calculatedDeliveryDate;
    const finalRevisedDeliveryDate = maxLineVariance > 0
      ? addDays(poDeliveryDate, maxLineVariance)
      : poDeliveryDate;

    // Determine PO Status:
    // If all lines are completed -> Completed
    // If Stage 2 (PM Baseline) is completed on all lines -> In Progress
    // Else -> Baseline Pending
    const allLinesCompleted = productLines.every(l => l.status === 'Completed');
    const pmBaselineCompleted = productLines.every(l => {
      const pmMs = l.milestones.find(m => m.key === 'pm_baseline');
      return pmMs && pmMs.status === 'Completed';
    });

    let poStatus: PurchaseOrder['status'] = 'Baseline Pending';
    if (allLinesCompleted) {
      poStatus = 'Completed';
    } else if (pmBaselineCompleted) {
      poStatus = 'In Progress';
    }

    const newPO: PurchaseOrder = {
      id: poId,
      poNumber: poNum,
      customerName: group.customerName,
      customerPoRef: group.customerPoRef,
      poDate: effectivePoDate,
      contractReviewRef: `CR-IMP-${poNum}`,
      committedDeliveryDate: poDeliveryDate,
      revisedDeliveryDate: finalRevisedDeliveryDate,
      status: poStatus,
      productLines,
      revisions: [
        {
          revNumber: 0,
          requestedBy: activeRole,
          approvedBy: activeRole,
          approvedAt: new Date().toISOString(),
          reason: 'Bulk Data Import with historical milestone completions.',
          docRef: `IMP-${poNum}`,
          changes: []
        }
      ],
      attachments: [],
      createdBy: activeRole,
      createdAt: new Date().toISOString(),
      lastUpdatedBy: activeRole,
      lastUpdatedAt: new Date().toISOString(),
      isClosed: false
    };

    previewPOs.push(newPO);
  });

  return {
    isValid: errors.length === 0 && previewPOs.length > 0,
    totalRows: previewRows.length,
    totalPOs: previewPOs.length,
    totalProductLines: previewRows.length,
    errors,
    warnings,
    previewPOs,
    previewRows
  };
}
