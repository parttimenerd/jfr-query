import type { PlotRegistration } from './plotTypes';
import { tablePlot } from './TablePlot';
import { pieChartPlot } from './PieChartPlot';
import { lineChartPlot } from './LineChartPlot';
import { scatterPlot } from './ScatterPlot';
import { heatmapPlot } from './HeatmapPlot';
import { flameGraphPlot } from './FlameGraphPlot';
import { histogramPlot } from './HistogramPlot';
import { boxPlot } from './BoxPlot';
import { barChartPlot } from './BarChartPlot';

export const plotRegistry: Record<string, PlotRegistration<any>> = {
  [tablePlot.name]: tablePlot,
  [barChartPlot.name]: barChartPlot,
  [pieChartPlot.name]: pieChartPlot,
  [lineChartPlot.name]: lineChartPlot,
  [scatterPlot.name]: scatterPlot,
  [heatmapPlot.name]: heatmapPlot,
  [flameGraphPlot.name]: flameGraphPlot,
  [histogramPlot.name]: histogramPlot,
  [boxPlot.name]: boxPlot,
};
