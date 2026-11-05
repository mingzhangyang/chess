import test from 'node:test';
import assert from 'node:assert/strict';
import { formatThinkTimeSeconds, getSettingLevel } from '../../src/utils/aiSettingsDisplay';
import { translate } from '../../src/i18n/translations';

test('Stockfish think time is displayed in seconds without rounding away tenths', () => {
  assert.equal(formatThinkTimeSeconds(200), '0.2');
  assert.equal(formatThinkTimeSeconds(3200), '3.2');
  assert.equal(formatThinkTimeSeconds(20000), '20.0');
});

test('AI settings map their existing numeric ranges onto low, medium and high', () => {
  assert.equal(getSettingLevel(0, 100), 'low');
  assert.equal(getSettingLevel(30, 100), 'low');
  assert.equal(getSettingLevel(35, 100), 'medium');
  assert.equal(getSettingLevel(65, 100), 'medium');
  assert.equal(getSettingLevel(70, 100), 'high');
  assert.equal(getSettingLevel(100, 100), 'high');
  assert.equal(getSettingLevel(45, 120), 'medium');
  assert.equal(getSettingLevel(120, 120), 'high');
});

test('new AI settings copy is localized in each supported language', () => {
  for (const language of ['en', 'zh', 'fr', 'es', 'ja'] as const) {
    for (const key of [
      'single.advancedSettings',
      'single.settingLevel.low',
      'single.settingLevel.medium',
      'single.settingLevel.high',
      'single.openingVarietyHelp',
      'single.antiShuffleHelp',
      'single.stockfishMoveTimeValue',
    ]) {
      assert.notEqual(translate(language, key), key);
    }
  }
  assert.equal(translate('en', 'single.stockfishMoveTimeValue', { seconds: '3.2' }), '3.2 seconds');
  assert.equal(translate('zh', 'single.stockfishMoveTimeValue', { seconds: '3.2' }), '3.2 秒');
});
