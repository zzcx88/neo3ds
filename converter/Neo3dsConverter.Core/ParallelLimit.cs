namespace Neo3dsConverter;

/// <summary>
/// #403: the one place every conversion <c>Parallel.For</c> takes its width from. A GUI batch
/// leaves one core free so the window keeps painting and the log keeps moving; a single
/// conversion and the CLI use every core. The limit is process-wide, so only a GUI batch turns it
/// on, through <see cref="ForBatch"/>, and turns it off again when the batch ends.
/// </summary>
public static class ParallelLimit
{
    static int batchDepth;

    /// <summary>The width for a run on <paramref name="processors"/> cores.</summary>
    public static int MaxDegreeFor(bool batch, int processors) =>
        batch ? Math.Max(1, processors - 1) : Math.Max(1, processors);

    /// <summary>True while a GUI batch holds a <see cref="ForBatch"/> scope.</summary>
    public static bool BatchActive => Volatile.Read(ref batchDepth) > 0;

    /// <summary>The width conversions use right now.</summary>
    public static int MaxDegree => MaxDegreeFor(BatchActive, Environment.ProcessorCount);

    /// <summary>Options for a conversion <c>Parallel.For</c>.</summary>
    public static ParallelOptions Options => new() { MaxDegreeOfParallelism = MaxDegree };

    /// <summary>Leaves one core free until the returned scope is disposed.</summary>
    public static IDisposable ForBatch()
    {
        Interlocked.Increment(ref batchDepth);
        return new Scope();
    }

    sealed class Scope : IDisposable
    {
        int disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0) Interlocked.Decrement(ref batchDepth);
        }
    }
}
