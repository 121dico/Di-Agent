"""只读提价前后固定人群核验；身份仅在内存中，标准输出仅含汇总。"""
import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # 重定向不得把签名带到管理员指定接口以外的地址。
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def compare_cohort(rows, raise_date, window):
    boundary = dt.date.fromisoformat(raise_date)
    start = str(boundary - dt.timedelta(days=window))
    end = str(boundary + dt.timedelta(days=window - 1))
    identities = collections.defaultdict(list)
    for row in rows:
        if int(row['duid']) > 0 and start <= row['dt'] <= end:
            identities[str(row['duid'])].append(row)
    bands = {}
    for observations in identities.values():
        before = [r for r in observations if r['dt'] < raise_date]
        eligible = [r for r in before if r.get('label_match_status') == 'MATCHED' and r.get('vehicle_type') == 'private']
        if not eligible:
            continue
        last_day = max(r['dt'] for r in eligible)
        levels = {r.get('ps_level') for r in eligible if r['dt'] == last_day}
        if len(levels) != 1:
            raise ValueError('提价前同日标签冲突')
        level = next(iter(levels))
        if level not in ('VERY_LOW', 'LOW', 'MEDIUM_LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH', 'VERY_HIGH'):
            level = 'UNKNOWN'
        # 固定提价前人群后，不再按提价后标签过滤，避免将缺失标签误判为未回访。
        after = [r for r in observations if r['dt'] >= raise_date]
        band = bands.setdefault(level, dict(users=0, returned=0, pre_orders=0, post_orders=0))
        band['users'] += 1
        band['returned'] += bool(after)
        band['pre_orders'] += sum(int(r['orders']) for r in before)
        band['post_orders'] += sum(int(r['orders']) for r in after)
    for band in bands.values():
        band['return_rate'] = band['returned'] / band['users']
        band['pre_orders_per_user'] = band['pre_orders'] / band['users']
        band['post_orders_per_user'] = band['post_orders'] / band['users']
        band['order_change'] = band['post_orders'] / band['pre_orders'] - 1
    return bands


def query(endpoint, headers, groups, conditions=None, orders=False):
    fields = [{'name': name} for name in groups]
    if orders:
        fields.append(dict(name='order_id', alias='orders', aggFunctionEnum='COUNT_DISTINCT'))
    result, seen, expected = [], set(), None
    for page in range(1, 101):
        payload = dict(fieldList=fields, groupList=groups, conditionList=conditions or [], orderBy=','.join(groups), needPagination=True, pageSize=5000, page=page, disableCache=True, useMockData=False)
        request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers=headers)
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
            envelope = json.load(response)
        if str(envelope.get('resultCode')) != '0':
            raise ValueError('上游查询失败，未输出原始错误或请求')
        data = envelope['data']
        total = int(data['paginationDTO']['total'])
        if expected is None:
            expected = total
        if expected != total or total > 500000:
            raise ValueError('分页总数变化或超过50万聚合组')
        for row in data['data']:
            key = tuple(row.get(name) for name in groups)
            if key in seen:
                raise ValueError('重复聚合组，停止核验')
            seen.add(key)
            if orders and (int(row['orders']) <= 0 or float(row['orders']) != int(row['orders'])):
                raise ValueError('订单数无效')
            result.append(row)
        if len(result) == total:
            return result
        if not data['data'] or len(result) > total:
            raise ValueError('分页不完整')
    raise ValueError('分页超限')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--endpoint', required=True)
    args = parser.parse_args()
    # 仅从已有配置读取，不保存、打印或上传凭据到其他目的地。
    env = dict(os.environ)
    for line in pathlib.Path(args.env_file).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    headers = {'Content-Type': 'application/json', 'User-Agent': 'data-service-sdk-v1', 'x-app-key': env['REPORT_STATION_DETAIL_APP_KEY'], 'sign': env['REPORT_STATION_DETAIL_SIGN'], 'x-date': env['REPORT_STATION_DETAIL_DATE']}
    dates = sorted(r['dt'] for r in query(args.endpoint, headers, ['dt']))
    metadata = query(args.endpoint, headers, ['station_id', 'station_name', 'raise_dt', 'planned_delta'])
    rows = query(args.endpoint, headers, ['dt', 'station_id', 'duid', 'ps_level', 'label_match_status', 'vehicle_type'], [dict(name='duid', operatorEnum='GQ', value=0)], True)
    by_station = collections.defaultdict(list)
    for row in rows:
        by_station[row['station_id']].append(row)
    plans = collections.defaultdict(list)
    for meta in metadata:
        plans[meta['station_id']].append(meta)
    output = dict(available_start=dates[0], available_end=dates[-1], date_count=len(dates), aggregate_groups=len(rows), stations=[], limitations=['计划提价非实付价格变化', '无电量/实付金额/周边价格，不能检验价格弹性或更便宜站迁移', '无未提价对照组，不能归因', '固定提价前最后一次可匹配private消费等级，不是统一T-1标签快照'])
    for station, plan in sorted(plans.items()):
        item = dict(station_id=station, plans=plan, windows={})
        output['stations'].append(item)
        if len(plan) != 1:
            item['unavailable'] = '多组计划，需确认提价口径'
            continue
        try:
            boundary = dt.date.fromisoformat(plan[0]['raise_dt'])
        except (TypeError, ValueError):
            item['unavailable'] = '提价日缺失或无效'
            continue
        if not plan[0]['planned_delta'] or float(plan[0]['planned_delta']) <= 0:
            item['unavailable'] = '未配置正向提价'
            continue
        for window in (7, 14):
            needed = [str(boundary + dt.timedelta(days=i)) for i in range(-window, window)]
            missing = sorted(set(needed) - set(dates))
            if missing:
                item['windows'][window] = dict(unavailable='前后等长窗口不完整', missing_days=len(missing))
            else:
                item['windows'][window] = dict(start=needed[0], end=needed[-1], bands=compare_cohort(by_station[station], str(boundary), window))
    summary = {key: value for key, value in output.items() if key != 'stations'}
    summary['station_count'] = len(output['stations'])
    summary['windows'] = {}
    for window in (7, 14):
        totals, included = {}, []
        for station in output['stations']:
            sample = station['windows'].get(window, {})
            if 'bands' not in sample:
                continue
            included.append(station)
            for level, band in sample['bands'].items():
                total = totals.setdefault(level, dict(users=0, returned=0, pre_orders=0, post_orders=0))
                for key in total:
                    total[key] += band[key]
        for band in totals.values():
            band['return_rate'] = band['returned'] / band['users']
            band['pre_orders_per_user'] = band['pre_orders'] / band['users']
            band['post_orders_per_user'] = band['post_orders'] / band['users']
            band['order_change'] = band['post_orders'] / band['pre_orders'] - 1
        summary['windows'][window] = dict(stations=len(included), bands=totals, counting_basis='用户-场站对；跨站不去重，非全平台用户数')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('核验失败：请检查配置、接口可用性或数据完整性；未输出敏感原始错误。')
