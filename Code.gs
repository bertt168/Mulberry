/**
 * 花青果一頁式轉化站 - Google Apps Script 後端
 *
 * 工作表結構：
 * 1. Orders -> 訂單紀錄
 *    欄位：時間戳記、姓名、手機、寄送超商、店名、末五碼、數量、總金額
 *
 * 2. Config -> 參數設定
 *    欄位：參數名稱、數值、說明
 *
 * 建議參數：
 * stock_status      | 少量供應                                 | 前台庫存文案
 * price_1           | 650                                      | 1罐價格
 * price_2_plus      | 600                                      | 2罐以上單罐價格
 * bundle_4          | 2200                                     | 4罐特惠總價
 * max_qty           | 4                                        | 可訂上限，最大建議 4
 * bank_name         | 花青果收款帳戶                           | 銀行名稱
 * bank_code         | 700                                      | 銀行代碼
 * bank_account      | 1234-5678-9012                           | 匯款帳號
 * hero_image_url    | https://...                              | 前台主視覺圖片 URL
 *
 * 請在此填入 LINE Messaging API 需要的值：
 * - LINE_USER_ID：接收推播通知的使用者 ID
 * - CHANNEL_ACCESS_TOKEN：LINE Official Account 的 Channel Access Token
 *
 * 若你不想把敏感資料直接寫在程式碼中，也可以改用 Script Properties。
 */

var LINE_USER_ID = '';
var CHANNEL_ACCESS_TOKEN = '';

var 工作表名稱 = {
  訂單紀錄: '訂單紀錄',
  參數設定: '參數設定',
};

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'config';

  if (action === 'config') {
    return 輸出JSON_({
      success: true,
      config: 取得公開參數_(),
    });
  }

  return 輸出JSON_({
    success: false,
    message: '不支援的操作。',
  });
}

function doPost(e) {
  try {
    var payload = 解析請求內容_(e);
    var config = 取得公開參數_();

    驗證訂單資料_(payload, config);

    var 後端重算總價 = 計算總金額_(Number(payload.quantity), config);
    payload.totalAmount = 後端重算總價;

    寫入訂單紀錄_(payload);
    發送LINE通知_(payload, config);

    return 輸出JSON_({
      success: true,
      message: '訂單已建立。',
    });
  } catch (error) {
    return 輸出JSON_({
      success: false,
      message: error.message || '系統發生未預期錯誤。',
    });
  }
}

function 輸出JSON_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function 解析請求內容_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('缺少請求內容。');
  }

  return JSON.parse(e.postData.contents);
}

function 取得試算表_() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var spreadsheetId = scriptProperties.getProperty('SPREADSHEET_ID');

  if (!spreadsheetId) {
    throw new Error('請先在 Script Properties 設定 SPREADSHEET_ID。');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function 取得工作表_名稱不存在則報錯(sheetName) {
  var sheet = 取得試算表_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('找不到工作表：' + sheetName);
  }
  return sheet;
}

function 讀取參數表_() {
  var sheet = 取得工作表_名稱不存在則報錯(工作表名稱.參數設定);
  var values = sheet.getDataRange().getValues();
  var map = {};

  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    var value = values[i][1];

    if (!key) continue;
    map[key] = value;
  }

  return map;
}

function 取得公開參數_() {
  var map = 讀取參數表_();

  return {
    stockStatus: String(map.stock_status || '少量供應'),
    price1: Number(map.price_1 || 650),
    price2Plus: Number(map.price_2_plus || 600),
    bundle4: Number(map.bundle_4 || 2200),
    maxQty: Number(map.max_qty || 4),
    bankName: String(map.bank_name || '花青果收款帳戶'),
    bankCode: String(map.bank_code || '700'),
    bankAccount: String(map.bank_account || ''),
    heroImageUrl: String(map.hero_image_url || ''),
  };
}

function 驗證訂單資料_(payload, config) {
  var 必填欄位 = ['name', 'phone', 'storeType', 'storeName', 'lastFiveDigits', 'quantity'];

  必填欄位.forEach(function(field) {
    if (!payload[field]) {
      throw new Error('缺少欄位：' + field);
    }
  });

  if (!/^09\d{8}$/.test(String(payload.phone))) {
    throw new Error('手機格式錯誤，請輸入 09 開頭的 10 碼手機號碼。');
  }

  if (!/^\d{5}$/.test(String(payload.lastFiveDigits))) {
    throw new Error('匯款末五碼格式錯誤，請輸入 5 碼數字。');
  }

  var maxQty = Math.max(1, Math.min(4, Number(config.maxQty || 4)));
  var quantity = Number(payload.quantity);
  if (!quantity || quantity < 1 || quantity > maxQty) {
    throw new Error('訂購數量超出範圍，目前允許 1 到 ' + maxQty + ' 罐。');
  }
}

function 計算總金額_(quantity, config) {
  if (quantity === 4) {
    return Number(config.bundle4);
  }

  if (quantity >= 2) {
    return quantity * Number(config.price2Plus);
  }

  return Number(config.price1);
}

function 寫入訂單紀錄_(payload) {
  var sheet = 取得工作表_名稱不存在則報錯(工作表名稱.訂單紀錄);

  sheet.appendRow([
    new Date(),
    payload.name,
    payload.phone,
    payload.storeType,
    payload.storeName,
    payload.lastFiveDigits,
    Number(payload.quantity),
    Number(payload.totalAmount),
  ]);
}

function 發送LINE通知_(payload, config) {
  if (!LINE_USER_ID || !CHANNEL_ACCESS_TOKEN) {
    Logger.log('尚未設定 LINE_USER_ID 或 CHANNEL_ACCESS_TOKEN，略過 LINE 通知。');
    return;
  }

  var message = [
    '【花青果新訂單通知】',
    '姓名：' + payload.name,
    '手機：' + payload.phone,
    '寄送超商：' + payload.storeType,
    '店名：' + payload.storeName,
    '末五碼：' + payload.lastFiveDigits,
    '數量：' + payload.quantity + ' 罐',
    '總金額：NT$' + payload.totalAmount,
    '匯款帳號：' + config.bankCode + ' / ' + config.bankAccount,
  ].join('\n');

  var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    payload: JSON.stringify({
      to: LINE_USER_ID,
      messages: [
        {
          type: 'text',
          text: message,
        },
      ],
    }),
    muteHttpExceptions: true,
  });

  Logger.log(response.getContentText());
}
