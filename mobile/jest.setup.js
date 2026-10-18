/* global jest */
// Native modules are replaced with in-memory or Node equivalents; app code runs unmodified.

jest.mock('expo-sqlite/kv-store', () => {
  const map = new Map();
  const storage = {
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    getItemSync: (k) => (map.has(k) ? map.get(k) : null),
    setItemSync: (k, v) => void map.set(k, v),
    removeItemSync: (k) => void map.delete(k),
    clear: async () => map.clear(),
  };
  return { __esModule: true, default: storage, Storage: storage, AsyncStorage: storage };
});

jest.mock('@/db', () => ({ getDb: () => require('./test-utils/testDb').getTestDb() }));

jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'native-date-picker' }) };
});

jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Chart = () => React.createElement(View, { testID: 'chart' });
  return { BarChart: Chart, LineChart: Chart, PieChart: Chart };
});

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => undefined), impactAsync: jest.fn(async () => undefined) }));

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => undefined), hideAsync: jest.fn(async () => undefined) }));

// Icon fonts need native font loading; render the icon name as plain text instead.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = () => React.createElement(Text, { accessibilityElementsHidden: true }, '');
  Icon.glyphMap = {};
  return { __esModule: true, default: Icon };
});
