"""Live CLI integration test. Run from the repo with .venv/Scripts/python scripts/e2e.py --live.

Uses configured B2 credentials without printing them. Creates only tiny synthetic
inputs under a unique tests/e2e prefix; deletes those exact test versions on exit.
Local fixtures and a JSON report remain in build/e2e/<run-id>.
"""
import argparse
import hashlib
import json
import math
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', required=True,
                        help='Authorize small test uploads and cleanup in configured B2 bucket')
    parser.add_argument('--providers', action='store_true', help='Also scrape one public Copernicus product and preview')
    options = parser.parse_args()
    identity = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:12]
    folder = ROOT / 'build' / 'e2e' / identity
    folder.mkdir(parents=True)
    prefix = 'tests/e2e/' + identity + '/'
    native = ROOT / 'build' / 'native'
    cli = native / 'fireblock.exe'
    report = {'run_id': identity, 'prefix': prefix, 'fixture_type': 'synthetic',
              'checks': [], 'status': 'running', 'cleanup': 'pending'}
    started = time.monotonic()

    def save():
        report['seconds'] = round(time.monotonic() - started, 2)
        (folder / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    def check(name, condition=True):
        if not condition:
            raise AssertionError(name)
        report['checks'].append(name)
        save()
        print('PASS ' + name, flush=True)

    def execute(exe, *args, failure=False):
        result = subprocess.run([str(exe), *map(str, args)], cwd=ROOT,
                                capture_output=True, encoding='utf-8', timeout=180)
        if (result.returncode == 0) == failure:
            # No provider response, bearer URL, or subprocess stderr in diagnostics.
            raise RuntimeError(f'{Path(exe).name} {args[0]} unexpected exit {result.returncode}')
        return result.stdout.strip()

    def b2(*args, failure=False):
        output = execute(cli, *args, failure=failure)
        return None if failure else json.loads(output)

    def write_json(path, value):
        path.write_text(json.dumps(value, indent=2), encoding='utf-8')
        return path

    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    try:
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        with rasterio.Env() as environment:
            check('JPEG2000 driver available', 'JP2OpenJPEG' in environment.drivers())
        raw = folder / 'raw input'
        (raw / 'firms').mkdir(parents=True)
        csv = raw / 'firms' / 'fires.csv'
        row = '38,-122,2024-02-29,5,n,12.5\n'
        csv.write_text('latitude,longitude,acq_date,acq_time,confidence,frp\n' + row + row +
                       '91,-122,2024-02-29,1200,h,2\n', encoding='utf-8')
        product = raw / 'copernicus' / 'synthetic'
        product.mkdir(parents=True)
        safe = folder / 'synthetic.SAFE'
        safe.mkdir()
        xml = ('<root><BOA_QUANTIFICATION_VALUE>10000</BOA_QUANTIFICATION_VALUE>'
               '<PROCESSING_BASELINE>05.00</PROCESSING_BASELINE>' + ''.join(
                   f'<BOA_ADD_OFFSET band_id="{i}">-1000</BOA_ADD_OFFSET>' for i in (3, 7, 11)) + '</root>')
        (safe / 'MTD_MSIL2A.xml').write_text(xml, encoding='utf-8')
        for band, resolution, size, value in [('B04', 10, 4, 3000), ('B08', 10, 4, 7000),
                                               ('B11', 20, 2, 4000), ('SCL', 20, 2, 4)]:
            path = safe / 'GRANULE' / 'tile' / 'IMG_DATA' / f'R{resolution}m' / f'tile_{band}_{resolution}m.jp2'
            path.parent.mkdir(parents=True, exist_ok=True)
            array = np.full((size, size), value, dtype='uint16')
            if band == 'SCL':
                array = np.array([[4, 9], [5, 0]], dtype='uint16')
            with rasterio.open(path, 'w', driver='JP2OpenJPEG', width=size, height=size,
                               count=1, dtype='uint16', crs='EPSG:32610',
                               transform=from_origin(500000, 4200000, resolution, resolution),
                               REVERSIBLE='YES', QUALITY=100) as target:
                target.write(array, 1)
        with zipfile.ZipFile(product / 'product.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in safe.rglob('*'):
                if path.is_file():
                    archive.write(path, path.relative_to(safe.parent).as_posix())
        write_json(product / 'metadata.json', {'Id': 'synthetic', 'Name': 'synthetic.SAFE',
                   'GeoFootprint': {'type': 'Polygon', 'coordinates': [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]]}})
        (product / 'quicklook.image').write_bytes(b'synthetic-preview-ignored')
        (raw / '.env').write_text('TEST_SENTINEL=must-not-publish', encoding='utf-8')

        # Real Windows executable, credentials, network, and provider storage.
        source = folder / 'local spaces \u00e9.bin'
        source.write_bytes(bytes(range(256)) * 257)
        key = prefix + 'storage/spaces \u00e9.bin'
        uploaded = b2('upload', source, key)
        check('C++ binary upload SHA-1', uploaded['contentSha1'] == hashlib.sha1(source.read_bytes()).hexdigest())
        check('C++ list and info', any(o['fileId'] == uploaded['fileId'] for o in b2('list', prefix))
              and b2('info', uploaded['fileId'])['fileName'] == key)
        copy = folder / 'download.bin'
        b2('download', key, copy)
        exact = folder / 'exact.bin'
        b2('download-version', uploaded['fileId'], exact)
        check('Unicode names and byte-identical downloads', digest(source) == digest(copy) == digest(exact))
        b2('download', key, copy, failure=True)
        check('Existing download preserved', digest(source) == digest(copy) and not Path(str(copy) + '.part').exists())
        b2('download', prefix + 'missing', folder / 'missing.bin', failure=True)
        check('Failed download removes partial', not (folder / 'missing.bin').exists() and not (folder / 'missing.bin.part').exists())
        b2('share', key, '--seconds', '0', failure=True)
        check('Invalid sharing expiry rejected')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        shared = execute(cli, 'share', key, '--seconds', '60')
        with urllib.request.build_opener(NoRedirect).open(shared, timeout=30) as response:
            shared_bytes = response.read()
        check('Temporary sharing URL downloads exact bytes', shared_bytes == source.read_bytes())
        b2('hide', key)
        check('Hide marker removes current listing but retains exact version',
              not b2('list', prefix + 'storage/') and len(b2('versions', prefix + 'storage/')) == 2)
        after_hide = folder / 'hidden-version.bin'
        b2('download-version', uploaded['fileId'], after_hide)
        check('Hidden object remains readable by version', digest(after_hide) == digest(source))

        receipt = json.loads(execute(native / 'fireblock_pipeline.exe', 'publish', raw, '--prefix', prefix.rstrip('/') + '/raw'))
        write_json(folder / 'publication.json', receipt)
        inventory = json.loads(Path(receipt['local_manifest']).read_text(encoding='utf-8'))
        check('Raw publication excludes root credentials', receipt['files'] == 4 and all(e['path'] != '.env' for e in inventory['files']))
        entry = next(e for e in inventory['files'] if e['path'] == 'firms/fires.csv')
        newer = folder / 'newer.csv'
        newer.write_text('invalid latest version', encoding='utf-8')
        b2('upload', newer, entry['key'])
        restored = folder / 'restored input'
        execute(native / 'fireblock_pipeline.exe', 'pull', receipt['manifest_file_id'], restored)
        check('Raw restore pins immutable versions', all(digest(raw / e['path']) == digest(restored / e['path']) for e in inventory['files']))
        execute(native / 'fireblock_pipeline.exe', 'pull', receipt['manifest_file_id'], restored, failure=True)
        check('Existing restore destination preserved', digest(csv) == digest(restored / 'firms/fires.csv'))
        # C++ metadata parser consumes the restored raw tree independently.
        cpp_job = json.loads((ROOT / 'config/parsing.example.json').read_text())
        cpp_job.update(input_root=str(restored), output_root=str(folder / 'cpp parsed'))
        cpp_job['firms']['invalid_rows'] = 'skip'
        execute(native / 'fireblock_parse.exe', write_json(folder / 'cpp-job.json', cpp_job))
        cpp_manifest = next((folder / 'cpp parsed').glob('*/manifest.json'))
        check('C++ parser consumes restored FIRMS and product metadata', len(json.loads(cpp_manifest.read_text())['artifacts']) >= 2)

        job = {'source': {'prefix': prefix + 'raw/'}, 'max_inputs': 10,
               'output_root': str(folder / 'analysis'),
               'storage': {'executable': str(cli), 'env_file': str(ROOT / '.env'),
                           'output_prefix': prefix.rstrip('/') + '/analysis', 'upload_results': True}}
        config = write_json(folder / 'cloud-job.json', job)
        resolved = folder / 'discovered.json'
        launcher = native / 'fireblock_analyze.exe'
        execute(launcher, '--python', sys.executable, 'cloud', config, '--discover-only', '--job-out', resolved)
        discovered = json.loads(resolved.read_text())
        check('Live cloud discovery selects completed batch', len(discovered['scenes']) == 1 and len(discovered['firms']) == 1
              and discovered['firms'][0]['input']['file_id'] == entry['file_id'] and discovered['discovery']['ignored'] == 2)
        job['source'] = {'manifest_file_id': receipt['manifest_file_id']}
        write_json(config, job)
        execute(launcher, '--python', sys.executable, 'cloud', config)
        manifest_path = next((folder / 'analysis').glob('*/manifest.json'))
        manifest = json.loads(manifest_path.read_text())
        check('C++ launcher completes live cloud analysis', manifest['status'] == 'complete')
        firms = manifest['firms'][0]
        check('FIRMS expected counts and FRP', (firms['accepted'], firms['rejected'], firms['duplicates']) == (1, 1, 1)
              and firms['frp_mw_sum_of_detections'] == 12.5)
        scene = manifest['scenes'][0]
        check('SAFE archive NDVI and NDMI values', math.isclose(scene['indices']['ndvi']['statistics']['mean'], .5, abs_tol=1e-5)
              and math.isclose(scene['indices']['ndmi']['statistics']['mean'], 1 / 3, abs_tol=1e-5))
        check('Cloud coverage and usability', not scene['usable'] and all(
            scene['indices'][name]['coverage']['valid_fraction'] == .5 and
            scene['indices'][name]['coverage']['cloud_fraction'] == .25 for name in ['ndvi', 'ndmi']))
        remote_manifest = folder / 'remote-manifest.json'
        b2('download', manifest['manifest_key'], remote_manifest)
        check('Completed result manifest exists in B2', digest(remote_manifest) == digest(manifest_path))
        downloaded = folder / 'verified artifacts'
        downloaded.mkdir()
        for index, artifact in enumerate(manifest['artifacts']):
            path = downloaded / (str(index) + Path(artifact['path']).suffix)
            b2('download-version', artifact['storage']['file_id'], path)
            if digest(path) != artifact['sha256'] or path.stat().st_size != artifact['bytes']:
                raise AssertionError('Published artifact checksum mismatch')
        check('Every published artifact restored and SHA-256 verified', len(manifest['artifacts']) == 5)

        # The explicit job supplies a known acquisition time for the synthetic scene.
        # Cloud discovery currently leaves scene acquisition timestamps unspecified.
        from rasterio.warp import transform_bounds
        risk_job = discovered
        risk_job['bbox'] = list(transform_bounds('EPSG:32610', 'EPSG:4326', 500000, 4199960, 500040, 4200000))
        risk_job['scenes'][0]['acquired_at'] = '2024-02-29T00:00:00Z'
        risk_job['risk'] = {'enabled': True, 'as_of': '2024-03-01T00:00:00Z',
                            'cell_km': .1, 'min_valid_fraction': .1, 'data_label': 'Synthetic end-to-end test'}
        risk_job['output_root'] = str(folder / 'risk analysis')
        execute(launcher, '--python', sys.executable, 'run', write_json(folder / 'risk-job.json', risk_job))
        risk_manifest_path = next((folder / 'risk analysis').glob('*/manifest.json'))
        risk_manifest = json.loads(risk_manifest_path.read_text())
        check('Live risk map has an estimated cell with synthetic imagery',
              risk_manifest['status'] == 'complete' and risk_manifest['risk']['known_cells'] == 1
              and not risk_manifest['risk']['prediction_available'])
        for index, artifact in enumerate(risk_manifest['artifacts']):
            path = downloaded / ('risk-' + str(index) + Path(artifact['path']).suffix)
            b2('download-version', artifact['storage']['file_id'], path)
            if digest(path) != artifact['sha256']:
                raise AssertionError('Risk artifact checksum mismatch')
        risk_remote = folder / 'remote-risk-manifest.json'
        b2('download', risk_manifest['manifest_key'], risk_remote)
        check('Risk map artifacts and completion manifest verified in B2',
              len(risk_manifest['artifacts']) == 10 and digest(risk_remote) == digest(risk_manifest_path))
        report['risk_map'] = str(risk_manifest_path.parent / 'risk/risk_map.html')

        if options.providers:
            provider_job = json.loads((ROOT / 'config/ingest.example.json').read_text(encoding='utf-8-sig'))
            provider_job.update(start='2024-02-20', end='2024-03-01', output=str(folder / 'provider input'))
            provider_job['bbox'] = [-122.6, 37.0, -121.5, 38.1]
            provider_job['copernicus'].update(max_products=1, quicklooks=True, products=False)
            provider_job['firms']['enabled'] = False
            provider_config = write_json(folder / 'provider-job.json', provider_job)
            output = execute(native / 'fireblock_pipeline.exe', 'scrape', provider_config,
                '--work', folder / 'provider work', '--prefix', prefix.rstrip('/') + '/provider')
            # scrape emits an ingestion progress line before its publication JSON.
            publication = json.loads(output[output.index('{'):])
            write_json(folder / 'provider-publication.json', publication)
            provider_inventory = json.loads(Path(publication['local_manifest']).read_text())
            provider_root = Path(publication['local_manifest']).parent
            catalogued = json.loads((provider_root / 'copernicus/catalogue.json').read_text())
            check('Live scraper publishes one Copernicus product and preview', len(catalogued) == 1 and
                  any(e['path'].endswith('/quicklook.image') and e['bytes'] > 0 for e in provider_inventory['files']))
            provider_restore = folder / 'provider restored'
            execute(native / 'fireblock_pipeline.exe', 'pull', publication['manifest_file_id'], provider_restore)
            check('Live provider dataset restored byte for byte', all(
                digest(provider_root / e['path']) == digest(provider_restore / e['path']) for e in provider_inventory['files']))
            cpp_job.update(input_root=str(provider_restore), output_root=str(folder / 'provider parsed'))
            execute(native / 'fireblock_parse.exe', write_json(folder / 'provider-parse.json', cpp_job))
            parsed = next((folder / 'provider parsed').glob('*/manifest.json'))
            check('C++ parser consumes real Copernicus metadata', bool(json.loads(parsed.read_text())['artifacts']))
        report['not_exercised'] = ['Live NASA FIRMS download (no FIRMS_MAP_KEY in process)',
                                  'Authenticated full Sentinel-2 download (no CDSE credentials in process)',
                                  'Bucket creation, deletion, or visibility changes']
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        # Assertion messages and our own errors contain no provider diagnostics.
        if isinstance(error, (AssertionError, RuntimeError)):
            report['error'] = str(error)
        print('FAIL ' + report['error_type'], flush=True)
    finally:
        try:
            objects = b2('versions', prefix)
            for obj in objects:
                if not obj['fileName'].startswith(prefix):
                    raise AssertionError('Cleanup target outside this test prefix')
                b2('delete', obj['fileName'], obj['fileId'], '--yes')
            remaining = b2('versions', prefix)
            report['cleanup'] = 'complete' if not remaining else 'incomplete'
            report['deleted_test_versions'] = len(objects)
        except Exception as error:
            report['cleanup'] = 'failed'
            report['cleanup_error_type'] = type(error).__name__
        save()
        print(json.dumps(report, indent=2), flush=True)
        print('Report: ' + str(folder / 'report.json'), flush=True)
    return 0 if report['status'] == 'passed' and report['cleanup'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
