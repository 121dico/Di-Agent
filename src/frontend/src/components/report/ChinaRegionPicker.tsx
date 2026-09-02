import React, { useEffect, useMemo, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import { chinaRegions } from './chinaRegionData';
import styles from './ChinaRegionPicker.module.css';

interface ChinaRegionPickerProps {
  value: string[];
  onChange: (cities: string[]) => void;
  provinceCodes?: string[];
  onProvinceChange?: (provinceCodes: string[]) => void;
}

interface ChinaRegionMapPanelProps extends ChinaRegionPickerProps {
  onRequestClose?: () => void;
}

const MAX_SELECTED_CITIES = 50;

function normalizeCityName(name: string): string {
  return name.trim().replace(/特别行政区$|自治州$|地区$|盟$|市$/u, '');
}

function isCitySelected(values: string[], candidate: string): boolean {
  const normalizedCandidate = normalizeCityName(candidate);
  return values.some((value) => normalizeCityName(value) === normalizedCandidate);
}

function toggleValue(values: string[], candidate: string): string[] {
  const existingIndex = values.findIndex((value) => normalizeCityName(value) === normalizeCityName(candidate));
  return existingIndex >= 0
    ? values.filter((_, index) => index !== existingIndex)
    : [...values, candidate];
}

function findProvinceCodeForCity(city: string): string {
  return chinaRegions.find((region) => region.cities.some((candidate) => normalizeCityName(candidate) === normalizeCityName(city)))?.code ?? '';
}

interface SelectionSummary {
  key: string;
  label: string;
  cities: string[];
  provinceCode?: string;
}

function buildSelectionSummaries(values: string[], provinceCodes: string[] = []): SelectionSummary[] {
  const consumed = new Set<string>();
  const summaries: SelectionSummary[] = [];
  provinceCodes.forEach((code) => {
    const region = chinaRegions.find((candidate) => candidate.code === code);
    if (!region) return;
    region.cities.forEach((city) => consumed.add(normalizeCityName(city)));
    summaries.push({ key: region.code, label: region.name, cities: region.cities, provinceCode: region.code });
  });
  values.forEach((city) => {
    if (!consumed.has(normalizeCityName(city))) summaries.push({ key: `city-${city}`, label: city, cities: [city] });
  });
  return summaries;
}

export function summarizeChinaRegionSelection(values: string[], provinceCodes: string[] = []): string {
  if (values.length === 0 && provinceCodes.length === 0) return '全部城市';
  const labels = buildSelectionSummaries(values, provinceCodes).map((summary) => summary.label);
  return labels.length <= 2 ? labels.join('、') : `${labels.slice(0, 2).join('、')}等 ${labels.length} 个区域`;
}

export function expandChinaRegionSelection(values: string[], provinceCodes: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const append = (city: string) => {
    const normalized = normalizeCityName(city);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    expanded.push(city);
  };
  values.forEach(append);
  provinceCodes.forEach((code) => chinaRegions.find((region) => region.code === code)?.cities.forEach(append));
  return expanded;
}

export const ChinaRegionMapPanel: React.FC<ChinaRegionMapPanelProps> = ({ value, onChange, provinceCodes, onProvinceChange, onRequestClose }) => {
  const [localProvinceCodes, setLocalProvinceCodes] = useState<string[]>([]);
  const selectedProvinceCodes = provinceCodes ?? localProvinceCodes;
  const updateProvinceCodes = onProvinceChange ?? setLocalProvinceCodes;
  const [activeProvinceCode, setActiveProvinceCode] = useState(() => findProvinceCodeForCity(value[value.length - 1] ?? ''));
  const [cityQuery, setCityQuery] = useState('');
  const [limitReached, setLimitReached] = useState(false);
  const activeProvince = chinaRegions.find((region) => region.code === activeProvinceCode);
  const activeCities = activeProvince?.cities ?? [];
  const visibleCities = useMemo(() => {
    const query = cityQuery.trim().toLowerCase();
    return query ? activeCities.filter((city) => city.toLowerCase().includes(query)) : activeCities;
  }, [activeCities, cityQuery]);
  const selectedRegionCount = useMemo(() => chinaRegions.filter((region) => (
    selectedProvinceCodes.includes(region.code) || region.cities.some((city) => isCitySelected(value, city))
  )).length, [selectedProvinceCodes, value]);
  const selectionSummaries = useMemo(() => buildSelectionSummaries(value, selectedProvinceCodes), [selectedProvinceCodes, value]);
  useEffect(() => {
    if (activeProvinceCode || value.length === 0) return;
    setActiveProvinceCode(findProvinceCodeForCity(value[value.length - 1] ?? ''));
  }, [activeProvinceCode, value]);

  const updateCity = (city: string) => {
    if (!isCitySelected(value, city) && value.length >= MAX_SELECTED_CITIES) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    onChange(toggleValue(value, city));
  };

  const toggleProvince = (code: string) => {
    const region = chinaRegions.find((candidate) => candidate.code === code);
    if (!region) return;
    const provinceSelected = selectedProvinceCodes.includes(code);
    const nextProvinceCodes = provinceSelected
      ? selectedProvinceCodes.filter((selectedCode) => selectedCode !== code)
      : [...selectedProvinceCodes, code];
    setActiveProvinceCode(provinceSelected ? (nextProvinceCodes[nextProvinceCodes.length - 1] ?? '') : code);
    setCityQuery('');
    setLimitReached(false);
    updateProvinceCodes(nextProvinceCodes);
  };

  return (
    <section className={styles.panel} aria-label="中国地图城市选择器">
      <header className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <strong>选择区域</strong>
          <span>点击省份多选，再次点击取消</span>
        </div>
        <div className={styles.selectionCount}><span>已选</span><strong>{selectedRegionCount}</strong><span>个区域</span></div>
      </header>

      <div className={`${styles.panelBody} ${activeProvince ? styles.panelBodyWithCities : ''}`}>
        <div className={styles.mapStage}>
          <svg viewBox="60 8 420 320" role="img" aria-label="中国省级行政区域交互地图">
            {chinaRegions.map((region) => {
              const { code, name, cities: cityNames } = region;
              const selectedCount = cityNames.filter((city) => isCitySelected(value, city)).length;
              const provinceSelected = selectedProvinceCodes.includes(code);
              const selected = provinceSelected || selectedCount > 0;
              return (
                <path
                  key={code}
                  d={region.path}
                  role="button"
                  tabIndex={0}
                  aria-label={`${provinceSelected ? '取消选择' : '选择'}${name}`}
                  aria-pressed={provinceSelected}
                  data-active={activeProvinceCode === code || undefined}
                  data-selected={selected || undefined}
                  data-complete={provinceSelected || undefined}
                  className={styles.province}
                  onClick={() => toggleProvince(code)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleProvince(code);
                    }
                  }}
                >
                  <title>{provinceSelected ? `${name} · 已选，点击取消` : `${name}${selectedCount > 0 ? ` · 有 ${selectedCount} 个城市条件，点击选择省份` : ' · 点击选择'}`}</title>
                </path>
              );
            })}
          </svg>
        </div>

        {activeProvince && <aside className={styles.cityPanel} aria-live="polite">
            <div className={styles.cityPanelHead}>
              <div><span>当前区域</span><strong>{activeProvince.name}</strong></div>
              <em>{activeCities.length} 个可选城市</em>
            </div>
            {activeCities.length > 6 && <Input
              prefix={<SearchOutlined />}
              value={cityQuery}
              placeholder="搜索当前区域城市"
              aria-label="搜索当前区域城市"
              onChange={(event) => setCityQuery(event.target.value)}
              allowClear
            />}
            <div className={styles.cityGrid}>
              {visibleCities.map((city) => <button
                key={city}
                type="button"
                aria-label={`选择${city}`}
                aria-pressed={isCitySelected(value, city)}
                className={isCitySelected(value, city) ? styles.citySelected : ''}
                onClick={() => updateCity(city)}
              >
                <span>{city}</span><i />
              </button>)}
              {visibleCities.length === 0 && <div className={styles.cityEmpty}>没有匹配的城市</div>}
            </div>
            {limitReached && <p className={styles.limitNotice} role="status">单次最多选择 {MAX_SELECTED_CITIES} 个城市，请先移除部分城市。</p>}
        </aside>}
      </div>

      {(value.length > 0 || selectedProvinceCodes.length > 0 || onRequestClose) && <footer className={styles.panelFooter}>
        <div className={styles.selectedCities}>
          {value.length === 0 && selectedProvinceCodes.length === 0 ? <span>未选择区域 · 默认查看全部城市</span> : selectionSummaries.map((summary) => <button
            key={summary.key}
            type="button"
            onClick={() => {
              if (summary.provinceCode) {
                const nextProvinceCodes = selectedProvinceCodes.filter((code) => code !== summary.provinceCode);
                updateProvinceCodes(nextProvinceCodes);
                if (activeProvinceCode === summary.provinceCode) setActiveProvinceCode(nextProvinceCodes[nextProvinceCodes.length - 1] ?? '');
                return;
              }
              onChange(value.filter((selected) => !summary.cities.some((city) => normalizeCityName(city) === normalizeCityName(selected))));
            }}
            title={`移除${summary.label}`}
          ><span>{summary.label}</span><i>×</i></button>)}
        </div>
        <div className={styles.footerActions}>
          {(value.length > 0 || selectedProvinceCodes.length > 0) && <button type="button" aria-label="清空已选城市" onClick={() => { setLimitReached(false); setActiveProvinceCode(''); onChange([]); updateProvinceCodes([]); }}>清空</button>}
          {onRequestClose && <button type="button" className={styles.doneButton} onClick={onRequestClose}>完成</button>}
        </div>
      </footer>}
    </section>
  );
};

export const ChinaRegionPicker: React.FC<ChinaRegionPickerProps> = ({ value, onChange, provinceCodes, onProvinceChange }) => {
  return <ChinaRegionMapPanel value={value} onChange={onChange} provinceCodes={provinceCodes} onProvinceChange={onProvinceChange} />;
};
