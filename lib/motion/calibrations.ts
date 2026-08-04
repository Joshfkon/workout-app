/**
 * machine_calibrations CRUD. Calibrations are created in the wizard (an
 * online, deliberate flow) so plain Supabase calls are fine here — no outbox.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MachineCalibration, MountOrientation, Vec3 } from '@/types/motion';

interface CalibrationRow {
  id: string;
  exercise_id: string;
  label: string;
  seat_setting: string;
  mount_radius_mm: number;
  mount_orientation: MountOrientation;
  gravity_ref_start: Vec3;
  gravity_ref_end: Vec3;
  derived_pivot_axis: Vec3;
  axis_quality: number;
  derived_rom_degrees: number | null;
  schema_version: number;
  created_at: string;
}

function fromRow(row: CalibrationRow): MachineCalibration {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    label: row.label,
    seatSetting: row.seat_setting,
    mountRadius_mm: Number(row.mount_radius_mm),
    mountOrientation: row.mount_orientation,
    gravityRefStart: row.gravity_ref_start,
    gravityRefEnd: row.gravity_ref_end,
    derivedPivotAxis: row.derived_pivot_axis,
    axisQuality: Number(row.axis_quality),
    derivedRomDegrees: row.derived_rom_degrees === null ? null : Number(row.derived_rom_degrees),
    createdAt: row.created_at,
    schemaVersion: row.schema_version,
  };
}

export async function listCalibrations(
  supabase: SupabaseClient,
  userId: string
): Promise<MachineCalibration[]> {
  const { data, error } = await supabase
    .from('machine_calibrations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as CalibrationRow[]).map(fromRow);
}

export async function insertCalibration(
  supabase: SupabaseClient,
  userId: string,
  calibration: Omit<MachineCalibration, 'id' | 'createdAt'>
): Promise<MachineCalibration> {
  const { data, error } = await supabase
    .from('machine_calibrations')
    .insert({
      user_id: userId,
      exercise_id: calibration.exerciseId,
      label: calibration.label,
      seat_setting: calibration.seatSetting,
      mount_radius_mm: calibration.mountRadius_mm,
      mount_orientation: calibration.mountOrientation,
      gravity_ref_start: calibration.gravityRefStart,
      gravity_ref_end: calibration.gravityRefEnd,
      derived_pivot_axis: calibration.derivedPivotAxis,
      axis_quality: calibration.axisQuality,
      derived_rom_degrees: calibration.derivedRomDegrees,
      schema_version: calibration.schemaVersion,
    })
    .select('*')
    .single();
  if (error) throw error;
  return fromRow(data as CalibrationRow);
}

/**
 * Delete a calibration. The database RESTRICTs deletion while captures
 * reference it — surfaced to the caller as `in-use`.
 */
export async function deleteCalibration(
  supabase: SupabaseClient,
  userId: string,
  calibrationId: string
): Promise<'deleted' | 'in-use'> {
  const { error } = await supabase
    .from('machine_calibrations')
    .delete()
    .eq('id', calibrationId)
    .eq('user_id', userId);
  if (error) {
    if (error.code === '23503') return 'in-use'; // FK violation from RESTRICT
    throw error;
  }
  return 'deleted';
}
