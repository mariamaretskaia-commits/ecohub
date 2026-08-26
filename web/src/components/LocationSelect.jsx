import { OBLASTS, getSettlements, getDistricts } from '../locations';

export default function LocationSelect({
  oblast,
  settlement,
  district = '',
  districts,
  onChange,
  required = false,
  allowEmpty = false,
  multiDistrict = false,
  compact = false,
}) {
  const settlements = getSettlements(oblast);
  const districtOptions = getDistricts(oblast, settlement);
  const selectedDistricts = multiDistrict ? (districts || []) : (district ? [district] : []);
  const grodnoCity = settlement === 'Гродно';
  const exclusiveDistrict = grodnoCity;

  const emit = (next) => {
    onChange({
      oblast,
      settlement,
      district: next.district ?? district,
      districts: next.districts ?? selectedDistricts,
      ...next,
    });
  };

  const toggleDistrict = (name) => {
    if (exclusiveDistrict) {
      const same = selectedDistricts.length === 1 && selectedDistricts[0] === name;
      emit({ district: same ? '' : name, districts: same ? [] : [name] });
      return;
    }
    const next = selectedDistricts.includes(name)
      ? selectedDistricts.filter((item) => item !== name)
      : [...selectedDistricts, name];
    emit({ district: next[0] || '', districts: next });
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'space-y-3'}>
      <label className="block min-w-0">
        <span className="type-label">Область</span>
        <select
          value={oblast}
          onChange={(e) => emit({ oblast: e.target.value, settlement: '', district: '', districts: [] })}
          className={compact ? 'field !mt-0.5 !p-2.5 !text-xs' : 'field'}
          required={required}
        >
          <option value="">{allowEmpty ? 'Любая область' : 'Выбрать область'}</option>
          {OBLASTS.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>

      <label className="block min-w-0">
        <span className="type-label">Город</span>
        <select
          value={settlement}
          onChange={(e) => emit({ oblast, settlement: e.target.value, district: '', districts: [] })}
          className={compact ? 'field !mt-0.5 !p-2.5 !text-xs' : 'field'}
          disabled={!oblast}
          required={required}
        >
          <option value="">{allowEmpty ? 'Любой населённый пункт' : 'Выбрать населённый пункт'}</option>
          {settlements.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      </div>

      <div>
        <span className="type-label">
          {grodnoCity ? 'Район города' : multiDistrict ? 'Районы – можно несколько' : 'Район'}
        </span>
        {multiDistrict ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={!settlement}
              onClick={() => emit({ district: '', districts: [] })}
              className={`filter-chip ${selectedDistricts.length === 0 ? 'filter-chip-active' : 'filter-chip-inactive'}`}
            >
              {grodnoCity ? 'Весь город' : 'Все районы'}
            </button>
            {districtOptions.map((name) => (
              <button
                type="button"
                key={name}
                disabled={!settlement}
                onClick={() => toggleDistrict(name)}
                className={`filter-chip ${selectedDistricts.includes(name) ? 'filter-chip-active' : 'filter-chip-inactive'}`}
              >
                {grodnoCity ? `${name} район` : name}
              </button>
            ))}
          </div>
        ) : (
          <select
            value={district}
            onChange={(e) => emit({ district: e.target.value, districts: e.target.value ? [e.target.value] : [] })}
            className="field"
            disabled={!settlement}
            required={required}
          >
            <option value="">{allowEmpty ? 'Любой район' : 'Выбрать район'}</option>
            {districtOptions.map((name) => (
              <option key={name} value={name}>{grodnoCity ? `${name} район` : name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
