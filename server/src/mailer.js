'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendSuccessEmail(toEmail, booking, passenger) {
  const subject = '【高鐵訂票】訂票成功！';
  const text = [
    '您的高鐵票已成功訂購！',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.fromStation + ' → ' + booking.toStation,
    '日期：' + booking.date,
    '車次：' + booking.trainNo,
    '訂位代號：' + booking.ticketNo,
    '嘗試次數：' + booking.retryCount,
    '',
    '請記得在發車前至超商或車站取票付款。',
  ].join('\n');

  await transporter.sendMail({ from: process.env.GMAIL_USER, to: toEmail, subject, text });
}

async function sendFailureEmail(toEmail, booking, passenger, reason) {
  const subject = '【高鐵訂票】訂票失敗';
  const text = [
    '很抱歉，您的高鐵訂票未能成功。',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.fromStation + ' → ' + booking.toStation,
    '日期：' + booking.date,
    '期望時間：' + booking.desiredTime,
    '嘗試次數：' + booking.retryCount,
    '失敗原因：' + reason,
    '',
    '請手動前往高鐵官網訂票：https://irs.thsrc.com.tw/IMINT/',
  ].join('\n');

  await transporter.sendMail({ from: process.env.GMAIL_USER, to: toEmail, subject, text });
}

module.exports = { sendSuccessEmail, sendFailureEmail };
