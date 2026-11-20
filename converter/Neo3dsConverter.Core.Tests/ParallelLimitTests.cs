using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #403: a GUI batch leaves one core for the window; a single conversion and the CLI use them all.
/// The limit is process-wide, so these tests also check that a finished batch puts it back.
/// </summary>
public sealed class ParallelLimitTests
{
    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 1)]
    [InlineData(8, 7)]
    [InlineData(16, 15)]
    public void ABatchLeavesOneCoreButNeverDropsBelowOne(int processors, int expected) =>
        Assert.Equal(expected, ParallelLimit.MaxDegreeFor(batch: true, processors));

    [Theory]
    [InlineData(1)]
    [InlineData(8)]
    [InlineData(16)]
    public void ASingleConversionUsesEveryCore(int processors) =>
        Assert.Equal(processors, ParallelLimit.MaxDegreeFor(batch: false, processors));

    [Fact]
    public void WithoutABatchScopeConversionsUseEveryCore()
    {
        // The CLI never opens a scope, so this is the width it gets.
        Assert.False(ParallelLimit.BatchActive);
        Assert.Equal(Environment.ProcessorCount, ParallelLimit.MaxDegree);
        Assert.Equal(Environment.ProcessorCount, ParallelLimit.Options.MaxDegreeOfParallelism);
    }

    [Fact]
    public void ABatchScopeLeavesOneCoreUntilItEnds()
    {
        using (ParallelLimit.ForBatch())
        {
            Assert.True(ParallelLimit.BatchActive);
            Assert.Equal(Math.Max(1, Environment.ProcessorCount - 1), ParallelLimit.Options.MaxDegreeOfParallelism);
        }

        Assert.False(ParallelLimit.BatchActive);
        Assert.Equal(Environment.ProcessorCount, ParallelLimit.MaxDegree);
    }

    [Fact]
    public void DisposingAScopeTwiceDoesNotReleaseAnotherBatch()
    {
        using var outer = ParallelLimit.ForBatch();
        var inner = ParallelLimit.ForBatch();
        inner.Dispose();
        inner.Dispose();

        Assert.True(ParallelLimit.BatchActive);
    }

    [Fact]
    public void AFailedBatchStillPutsEveryCoreBack()
    {
        try
        {
            using var spare = ParallelLimit.ForBatch();
            throw new InvalidOperationException("conversion failed");
        }
        catch (InvalidOperationException) { }

        Assert.False(ParallelLimit.BatchActive);
    }
}
