import React from 'react';
import { Select } from 'antd';
import { ChinaRegionPicker, expandChinaRegionSelection } from './ChinaRegionPicker';
import { chinaRegions } from './chinaRegionData';
import styles from './ReportRegionFilter.module.css';

interface ReportRegionFilterProps {
  cities: string[];
  provinces: string[];
  onCities: (cities: string[]) => void;
  onProvinces: (provinces: string[]) => void;
  onReset: () => void;
}

const recommendedCities = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市', '武汉市', '重庆市'];
const cityOptions = [...new Set(chinaRegions.flatMap((region) => region.cities))].map((city) => ({ label: city, value: city }));

export const ReportRegionFilter: React.FC<ReportRegionFilterProps> = ({ cities, provinces, onCities, onProvinces, onReset }) => {
  const selectCities = (next: string[]) => {
    const added = next.filter((city) => !cities.includes(city));
    // 搜索具体城市时取消对应全省条件，避免查询范围仍包含整省。
    onProvinces(provinces.filter((code) => !chinaRegions.find((region) => region.code === code)?.cities.some((city) => added.includes(city))));
    onCities(next);
  };
  const toggleCity = (city: string) => {
    const province = chinaRegions.find((region) => region.cities.includes(city));
    if (province && provinces.includes(province.code)) {
      onProvinces(provinces.filter((code) => code !== province.code));
      onCities(cities.includes(city) ? cities : [...cities, city]);
    } else selectCities(cities.includes(city) ? cities.filter((value) => value !== city) : [...cities, city]);
  };
  return <section className={styles.root} aria-label="报表全局筛选">
    <div className={styles.cities}>
      <header><strong>城市</strong><button type="button" onClick={onReset}>重置</button></header>
      <Select mode="multiple" showSearch allowClear maxTagCount="responsive" value={cities} options={cityOptions} onChange={selectCities} placeholder="搜索城市" aria-label="搜索城市" />
      <div className={styles.recommended} aria-label="推荐城市">{recommendedCities.map((city) => <button key={city} type="button" aria-pressed={cities.includes(city)} onClick={() => toggleCity(city)}>{city.replace(/市$/, '')}</button>)}</div>
      {provinces.length > 0 && <div className={styles.provinces}>{provinces.map((code) => <button key={code} type="button" aria-label={`移除${chinaRegions.find((region) => region.code === code)?.name}`} onClick={() => onProvinces(provinces.filter((value) => value !== code))}>{chinaRegions.find((region) => region.code === code)?.name} ×</button>)}</div>}
      {expandChinaRegionSelection(cities, provinces).length > 50 && <small role="alert">最多50个城市，请减少已选区域</small>}
    </div>
    <ChinaRegionPicker compact value={cities} onChange={onCities} provinceCodes={provinces} onProvinceChange={onProvinces} />
  </section>;
};
