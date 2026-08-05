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
import { areaChartPlot } from './AreaChartPlot';
import { ganttChartPlot } from './GanttChartPlot';
import { rangePlot } from './RangePlot';
import { treemapPlot } from './TreemapPlot';
import { waterfallPlot } from './WaterfallPlot';
import { violinPlot } from './ViolinPlot';
import { sunburstPlot } from './SunburstPlot';
import { sankeyPlot } from './SankeyPlot';
import { crosstabPlot } from './CrosstabPlot';
import { bigNumberPlot } from './BigNumberPlot';

export const plotRegistry: Record<string, PlotRegistration<any>> = {
  [tablePlot.name]: tablePlot,
  [barChartPlot.name]: barChartPlot,
  [pieChartPlot.name]: pieChartPlot,
  [lineChartPlot.name]: lineChartPlot,
  [scatterPlot.name]: scatterPlot,
  // SCATTER is an alias for SCATTER_PLOT (short form used in templates).
  SCATTER: scatterPlot,
  [heatmapPlot.name]: heatmapPlot,
  [flameGraphPlot.name]: flameGraphPlot,
  // FLAME_GRAPH is an alias for FLAMEGRAPH (both spellings accepted).
  FLAME_GRAPH: flameGraphPlot,
  [histogramPlot.name]: histogramPlot,
  [boxPlot.name]: boxPlot,
  [areaChartPlot.name]: areaChartPlot,
  [ganttChartPlot.name]: ganttChartPlot,
  [rangePlot.name]: rangePlot,
  [treemapPlot.name]: treemapPlot,
  [waterfallPlot.name]: waterfallPlot,
  [violinPlot.name]: violinPlot,
  [sunburstPlot.name]: sunburstPlot,
  [sankeyPlot.name]: sankeyPlot,
  [crosstabPlot.name]: crosstabPlot,
  [bigNumberPlot.name]: bigNumberPlot,
};
