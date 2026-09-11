'use strict';

// 提前应用昼夜模式，避免页面载入时闪烁。
if (localStorage.getItem('leaf-dark') === '1') {
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('dark'));
}
