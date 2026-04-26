const SPREADSHEET_ID = '1oFh2T6MzB7KMokpsBBTThdyLzxbAhT0Xlo4exFXyEuA';

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name);
}

function generateId() {
  return Utilities.getUuid();
}

// 讀取整個 sheet，回傳 object 陣列（跳過 header row）
function sheetToObjects(sheetName, colsMap) {
  const sheet = getSheet(sheetName);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(row => {
    const obj = {};
    Object.entries(colsMap).forEach(([key, idx]) => {
      obj[toCamelCase(key)] = row[idx] === '' ? null : row[idx];
    });
    return obj;
  });
}

// 找到 id 對應的 row index（1-based，含 header）
function findRowById(sheetName, id) {
  const sheet = getSheet(sheetName);
  const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat();
  const idx = ids.indexOf(id);
  return idx === -1 ? -1 : idx + 1;
}

// 更新指定 row 的特定欄位
function updateRowFields(sheetName, id, colsMap, fields) {
  const sheet = getSheet(sheetName);
  const rowIndex = findRowById(sheetName, id);
  if (rowIndex === -1) throw new Error('Row not found: ' + id);
  Object.entries(fields).forEach(([key, value]) => {
    const colKey = toScreamingSnake(key);
    const colIdx = colsMap[colKey];
    if (colIdx === undefined) throw new Error('Unknown field: ' + key);
    sheet.getRange(rowIndex, colIdx + 1).setValue(value);
  });
}

// 新增一列（從 object 轉成 row array）
function appendRow(sheetName, colsMap, obj) {
  const sheet = getSheet(sheetName);
  const totalCols = Object.keys(colsMap).length;
  const row = new Array(totalCols).fill('');
  Object.entries(colsMap).forEach(([key, idx]) => {
    const camel = toCamelCase(key);
    row[idx] = obj[camel] !== undefined && obj[camel] !== null ? obj[camel] : '';
  });
  sheet.appendRow(row);
}

// 刪除 id 對應的 row
function deleteRowById(sheetName, id) {
  const sheet = getSheet(sheetName);
  const rowIndex = findRowById(sheetName, id);
  if (rowIndex === -1) throw new Error('Row not found: ' + id);
  sheet.deleteRow(rowIndex);
}

// 工具：SCREAMING_SNAKE → camelCase
function toCamelCase(str) {
  return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// 工具：camelCase → SCREAMING_SNAKE
function toScreamingSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toUpperCase();
}

function test_sheetHelpers() {
  console.log('toCamelCase PASSENGER_ID:', toCamelCase('PASSENGER_ID')); // passengerId
  console.log('toScreamingSnake passengerId:', toScreamingSnake('passengerId')); // PASSENGER_ID
  const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
  console.log('passengers:', JSON.stringify(passengers));
}
