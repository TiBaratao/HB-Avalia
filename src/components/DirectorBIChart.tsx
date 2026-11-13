"use client";

import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart, RadarChart } from "echarts/charts";
import { AxisPointerComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export interface DirectorChartEvent {
  name?: string;
  seriesName?: string;
  dataIndex?: number;
  value?: unknown;
  start?: number;
  end?: number;
  startValue?: number | string;
  endValue?: number | string;
  batch?: Array<{
    start?: number;
    end?: number;
    startValue?: number | string;
    endValue?: number | string;
  }>;
}

export function DirectorBIChart({
  title,
  option,
  onEvents,
  height = 300,
}: {
  title: string;
  option: EChartsOption;
  onEvents?: Record<string, (event: DirectorChartEvent) => void>;
  height?: number;
}) {
  return <section className="director-chart" aria-label={title}>
    <div className="director-chart-heading"><h3>{title}</h3></div>
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      onEvents={onEvents}
      notMerge
      lazyUpdate
      autoResize
      style={{ height }}
      opts={{ renderer: "canvas" }}
    />
  </section>;
}
