const TEMPLATE_ID = '1xpVfizaZGQ98fhD-LoVx7PbmXcM8W4QviDcP4fhxKAo';
const OUTPUT_FOLDER_ID = '';

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'products') {
    return productsResult_(e.parameter.callback);
  }
  return htmlResult_('CRM quote service is running.', '', '');
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.parameter && e.parameter.payload) || '{}');
    const result = createDocument_(payload);
    return htmlResult_('Tạo file thành công', result.sheetUrl, result.xlsxUrl);
  } catch (err) {
    return htmlResult_('Không tạo được file', '', '', err && err.message ? err.message : String(err));
  }
}

function createDocument_(payload) {
  if (!payload.customerName) throw new Error('Thiếu tên khách hàng.');
  if (!payload.items || !payload.items.length) throw new Error('Thiếu danh sách sản phẩm.');

  const type = payload.type === 'sample' ? 'sample' : 'quote';
  const prefix = type === 'sample' ? 'DXM' : 'BG';
  const fileName = `${prefix} - ${payload.customerName} - ${payload.ownerName || ''} - ${Utilities.formatDate(new Date(), 'Asia/Saigon', 'yyyy-MM-dd HHmm')}`;
  const template = DriveApp.getFileById(TEMPLATE_ID);
  const folder = OUTPUT_FOLDER_ID ? DriveApp.getFolderById(OUTPUT_FOLDER_ID) : template.getParents().hasNext() ? template.getParents().next() : DriveApp.getRootFolder();
  const copy = template.makeCopy(fileName, folder);
  const ss = SpreadsheetApp.openById(copy.getId());

  if (type === 'sample') fillSample_(ss, payload);
  else fillQuote_(ss, payload);

  SpreadsheetApp.flush();
  const xlsx = exportXlsx_(copy.getId(), `${fileName}.xlsx`, folder);
  return {sheetUrl: copy.getUrl(), xlsxUrl: xlsx.getUrl()};
}

function fillQuote_(ss, payload) {
  const sh = ss.getSheetByName('BÁO_GIÁ');
  if (!sh) throw new Error('Không thấy tab BÁO_GIÁ.');
  sh.getRangeList(['D8', 'D9', 'D10', 'J8', 'J9', 'J10', 'J11']).clearDataValidations();
  sh.getRange('C18:C97').clearDataValidations();
  sh.getRange('D8').setValue(payload.customerName || '');
  sh.getRange('D9').setValue(payload.phone || '');
  sh.getRange('D10').setValue(payload.address || '');
  sh.getRange('J8').setValue(payload.ownerName || '');

  const start = 18;
  const maxRows = 80;
  sh.getRange(start, 3, maxRows, 1).clearContent();
  sh.getRange(start, 6, maxRows, 1).clearContent();
  sh.getRange(start, 8, maxRows, 1).clearContent();
  sh.getRange(start, 11, maxRows, 1).clearContent();

  payload.items.slice(0, maxRows).forEach((item, index) => {
    const row = start + index;
    sh.getRange(row, 3).setValue(item.product || '');
    sh.getRange(row, 6).setValue(Number(item.qty || 0));
    sh.getRange(row, 8).setValue(Number(item.discount || 0) / 100);
    sh.getRange(row, 11).setValue(item.area || '');
  });
}

function fillSample_(ss, payload) {
  const sh = ss.getSheetByName('ĐỀ_XUẤT_MẪU');
  if (!sh) throw new Error('Không thấy tab ĐỀ_XUẤT_MẪU.');
  sh.getRange('B17:B116').clearDataValidations();
  const start = 17;
  const maxRows = 100;
  sh.getRange(start, 2, maxRows, 1).clearContent();
  sh.getRange(start, 6, maxRows, 1).clearContent();
  payload.items.slice(0, maxRows).forEach((item, index) => {
    const row = start + index;
    sh.getRange(row, 2).setValue(item.product || '');
    sh.getRange(row, 6).setValue(Number(item.qty || 0) > 0);
  });
}

function productsResult_(callback) {
  const ss = SpreadsheetApp.openById(TEMPLATE_ID);
  const sh = ss.getSheetByName('THÔNG_TIN_GẠCH');
  if (!sh) throw new Error('Không thấy tab THÔNG_TIN_GẠCH.');
  const values = sh.getRange(2, 3, Math.max(0, sh.getLastRow() - 1), 1).getDisplayValues()
    .map(row => String(row[0] || '').trim())
    .filter(Boolean);
  const products = [...new Set(values)].sort();
  const json = JSON.stringify(products);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function exportXlsx_(spreadsheetId, fileName, folder) {
  const url = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`;
  const response = UrlFetchApp.fetch(url, {
    headers: {Authorization: `Bearer ${ScriptApp.getOAuthToken()}`},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const blob = response.getBlob().setName(fileName);
  return folder.createFile(blob);
}

function htmlResult_(title, sheetUrl, xlsxUrl, error) {
  const safe = value => String(value || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  return HtmlService.createHtmlOutput(`
    <meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#061633}
      a{display:block;margin:12px 0;color:#147a68;font-weight:700}
      .err{color:#b42318;font-weight:700}
    </style>
    <h2>${safe(title)}</h2>
    ${error ? `<p class="err">${safe(error)}</p>` : ''}
    ${sheetUrl ? `<a href="${safe(sheetUrl)}" target="_blank">Mở Google Sheet</a>` : ''}
    ${xlsxUrl ? `<a href="${safe(xlsxUrl)}" target="_blank">Tải/Mở file Excel</a>` : ''}
    <p>Sau khi kiểm tra file, bạn có thể xuất PDF từ Google Sheet hoặc Excel để gửi khách hàng.</p>
  `);
}
