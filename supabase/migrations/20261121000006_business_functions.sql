-- Entrega mínima: ahora + min_lead_hours, acotada a la ventana de entregas (sección 1.4 y 9.10)
-- ts: momento en que el cliente pide el pedido (requested_at), en UTC.
create or replace function min_delivery_at(ts timestamptz)
returns timestamptz
language plpgsql
as $$
declare
  v_tz text := 'America/Guayaquil';
  v_lead_hours numeric := 3;
  v_window_start time := '09:00';
  v_window_end time := '18:00';
  v_same_day_start time := '06:00';
  v_local timestamp := ts at time zone v_tz;
  v_local_time time := v_local::time;
  v_candidate timestamptz;
  v_candidate_local timestamp;
begin
  select (value #>> '{}')::numeric into v_lead_hours from app_settings where key = 'min_lead_hours';
  v_lead_hours := coalesce(v_lead_hours, 3);

  -- Antes de las 06:00: no hay entrega el mismo día, primera opción mañana 09:00
  if v_local_time < v_same_day_start then
    return (date_trunc('day', v_local) + interval '1 day' + v_window_start) at time zone v_tz;
  end if;

  v_candidate := ts + (v_lead_hours || ' hours')::interval;
  v_candidate_local := v_candidate at time zone v_tz;

  -- Si el candidato cae después del cierre de la ventana de entregas, se pasa a mañana 09:00
  if v_candidate_local::time > v_window_end then
    return (date_trunc('day', v_local) + interval '1 day' + v_window_start) at time zone v_tz;
  end if;

  -- Si el candidato cae antes de la apertura (pedido hecho de madrugada ya cubierto arriba,
  -- pero por seguridad), se ajusta a la apertura del mismo día
  if v_candidate_local::time < v_window_start then
    return (date_trunc('day', v_local) + v_window_start) at time zone v_tz;
  end if;

  return v_candidate;
end;
$$;

-- Valida un sector declarado (texto libre) contra coverage_zones.keywords (sección 9.4, sin polígonos aún)
create or replace function is_within_zone(p_text text)
returns table (matched boolean, zone_id uuid, zone_name text)
language plpgsql
as $$
declare
  v_normalized text := lower(unaccent(coalesce(p_text, '')));
begin
  return query
  select true, cz.id, cz.name
  from coverage_zones cz
  where cz.is_active
    and exists (
      select 1 from unnest(cz.keywords) kw
      where v_normalized like '%' || lower(unaccent(kw)) || '%'
    )
  limit 1;

  if not found then
    return query select false, null::uuid, null::text;
  end if;
end;
$$;
