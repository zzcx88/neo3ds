using Xunit;

// Avalonia headless tests share one UI thread, and Lang.Korean is process-wide. Both make
// parallel collections flaky, so the suite runs one collection at a time (#328).
[assembly: CollectionBehavior(DisableTestParallelization = true)]
