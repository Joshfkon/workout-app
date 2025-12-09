'use client';

import { useMemo } from 'react';
import type { FFMIResult } from '@/types/schema';
import { getFFMILabel, getFFMIColor } from '@/services/bodyCompEngine';

interface FFMIGaugeProps {
  ffmiResult: FFMIResult;
  size?: 'sm' | 'md' | 'lg';
}

export function FFMIGauge({ ffmiResult, size = 'md' }: FFMIGaugeProps) {
  const { normalizedFfmi, classification, naturalLimit, percentOfLimit } = ffmiResult;
  
  // Size configurations
  const sizeConfig = useMemo(() => {
    switch (size) {
      case 'sm':
        return { width: 160, height: 100, strokeWidth: 8, fontSize: 'text-xl' };
      case 'lg':
        return { width: 280, height: 160, strokeWidth: 14, fontSize: 'text-4xl' };
      case 'md':
      default:
        return { width: 220, height: 130, strokeWidth: 12, fontSize: 'text-3xl' };
    }
  }, [size]);
  
  // Calculate gauge arc
  const { width, height, strokeWidth } = sizeConfig;
  const radius = (width - strokeWidth * 2) / 2;
  const centerX = width / 2;
  const centerY = height - 10;
  
  // Arc starts at 180° (left) and ends at 0° (right)
  // We need to calculate the position based on FFMI percentage
  const startAngle = Math.PI; // 180 degrees
  const endAngle = 0; // 0 degrees
  const angleRange = startAngle - endAngle;
  
  // Calculate current angle based on percentage (capped at 100%)
  const cappedPercent = Math.min(percentOfLimit, 100);
  const currentAngle = startAngle - (cappedPercent / 100) * angleRange;
  
  // Calculate arc path
  const startX = centerX + radius * Math.cos(startAngle);
  const startY = centerY - radius * Math.sin(startAngle);
  const endX = centerX + radius * Math.cos(endAngle);
  const endY = centerY - radius * Math.sin(endAngle);
  const currentX = centerX + radius * Math.cos(currentAngle);
  const currentY = centerY - radius * Math.sin(currentAngle);
  
  // Background arc path (full semicircle)
  const bgPath = `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
  
  // Progress arc path
  const progressPath = `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${currentX} ${currentY}`;
  
  // Color based on classification
  const progressColor = useMemo(() => {
    switch (classification) {
      case 'below_average':
        return '#6b7280'; // gray
      case 'average':
        return '#60a5fa'; // blue
      case 'above_average':
        return '#34d399'; // green
      case 'excellent':
        return '#22c55e'; // bright green
      case 'superior':
        return '#a855f7'; // purple
      case 'suspicious':
        return '#f59e0b'; // amber
      default:
        return '#60a5fa';
    }
  }, [classification]);
  
  // Gradient zones on the gauge
  const zones = [
    { start: 0, end: 18, label: '<18', color: '#6b7280' },
    { start: 18, end: 20, label: '18-20', color: '#60a5fa' },
    { start: 20, end: 22, label: '20-22', color: '#34d399' },
    { start: 22, end: 23, label: '22-23', color: '#22c55e' },
    { start: 23, end: 25, label: '23-25', color: '#a855f7' },
    { start: 25, end: 30, label: '>25', color: '#f59e0b' },
  ];
  
  return (
    <div className="flex flex-col items-center">
      <svg 
        width={width} 
        height={height} 
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Background gradient zones */}
        <defs>
          <linearGradient id="ffmi-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6b7280" />
            <stop offset="20%" stopColor="#60a5fa" />
            <stop offset="40%" stopColor="#34d399" />
            <stop offset="60%" stopColor="#22c55e" />
            <stop offset="80%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        
        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="url(#ffmi-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.2}
        />
        
        {/* Progress arc */}
        <path
          d={progressPath}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
        
        {/* Indicator dot */}
        <circle
          cx={currentX}
          cy={currentY}
          r={strokeWidth / 2 + 2}
          fill={progressColor}
          stroke="white"
          strokeWidth={2}
          className="drop-shadow-lg"
        />
        
        {/* Scale markers */}
        {[18, 20, 22, 25].map((value) => {
          const percent = (value / naturalLimit) * 100;
          const angle = startAngle - (Math.min(percent, 100) / 100) * angleRange;
          const markerRadius = radius + strokeWidth / 2 + 8;
          const x = centerX + markerRadius * Math.cos(angle);
          const y = centerY - markerRadius * Math.sin(angle);
          
          return (
            <text
              key={value}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-surface-500 text-[10px]"
            >
              {value}
            </text>
          );
        })}
      </svg>
      
      {/* FFMI Value */}
      <div className="text-center -mt-2">
        <div className={`${sizeConfig.fontSize} font-bold ${getFFMIColor(classification)}`}>
          {normalizedFfmi}
        </div>
        <div className="text-sm text-surface-400 mt-1">
          {getFFMILabel(classification)}
        </div>
        <div className="text-xs text-surface-500 mt-0.5">
          {percentOfLimit}% of natural limit
        </div>
      </div>
    </div>
  );
}

