using Xunit;

// Lang.Korean is process-wide (Lang.Set), and the failure-message tests switch it to prove
// the KO/EN pair. Running test classes in parallel would let one class read the language a
// sibling just changed, so the suite runs one collection at a time (#328).
[assembly: CollectionBehavior(DisableTestParallelization = true)]
