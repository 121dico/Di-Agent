import type { ThemeConfig } from 'antd';

const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1d1d1f',
    colorInfo: '#005fcc',
    colorSuccess: '#167c46',
    colorWarning: '#9a5700',
    colorError: '#c2352a',
    borderRadius: 8,
    borderRadiusLG: 12,
    controlHeight: 34,
    controlHeightLG: 40,
    fontSize: 13,
    fontFamily: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif`,
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f7f7f5',
    colorBgElevated: '#ffffff',
    colorFillSecondary: '#f1f1ef',
    colorFillTertiary: '#f7f7f5',
    colorText: '#1d1d1f',
    colorTextSecondary: '#5f6368',
    colorTextTertiary: '#686b70',
    colorBorder: '#d8d8d4',
    colorBorderSecondary: '#e5e5e2',
    boxShadow: '0 1px 2px rgba(29,29,31,.04), 0 4px 14px rgba(29,29,31,.055)',
    boxShadowSecondary: '0 20px 56px rgba(29,29,31,.16), 0 4px 14px rgba(29,29,31,.08)',
  },
  components: {
    Button: {
      borderRadius: 7,
      controlHeight: 34,
      fontWeight: 560,
      primaryShadow: 'none',
    },
    Input: {
      borderRadius: 7,
      activeShadow: '0 0 0 3px rgba(10, 102, 255, 0.18)',
    },
    Select: {
      borderRadius: 7,
      activeBorderColor: '#0a66ff',
      activeOutlineColor: 'rgba(10, 102, 255, 0.18)',
    },
    Card: {
      borderRadiusLG: 10,
    },
    Modal: {
      borderRadiusLG: 12,
      contentBg: '#ffffff',
      headerBg: 'transparent',
    },
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 6,
      itemHeight: 40,
      iconSize: 17,
      itemSelectedBg: '#eef5ff',
      itemSelectedColor: '#1d1d1f',
    },
    Avatar: {
      borderRadius: 50,
    },
    Badge: {
      dotSize: 8,
    },
    Segmented: {
      itemSelectedBg: '#ffffff',
      trackBg: 'rgba(118, 118, 128, 0.12)',
      trackPadding: 3,
    },
    Tooltip: {
      borderRadius: 6,
    },
  },
};

export default theme;
