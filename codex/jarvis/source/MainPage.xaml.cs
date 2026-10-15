using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Streams;
using Windows.UI;
using VirtualKey = Windows.System.VirtualKey;

namespace Jarvis_VisualPrototype;

public sealed partial class MainPage : Page
{
    private enum VisualMode
    {
        Core,
        Command,
        Overlay,
        Diagnostics
    }

    private readonly Stopwatch _uptime = new();
    private readonly List<Polyline> _coreContours = [];
    private readonly List<RotateTransform> _ringRotations = [];
    private readonly List<Ellipse> _particles = [];
    private readonly List<(Ellipse Pulse, Point Start, Point End, double Offset)> _flowPulses = [];
    private readonly string[] _states = ["STANDBY", "LISTENING", "THINKING", "EXECUTING", "COMPLETE", "ALERT"];
    private readonly Color[] _stateColors =
    [
        Color.FromArgb(255, 105, 132, 153),
        Color.FromArgb(255, 56, 231, 255),
        Color.FromArgb(255, 72, 140, 255),
        Color.FromArgb(255, 95, 191, 255),
        Color.FromArgb(255, 60, 255, 180),
        Color.FromArgb(255, 255, 184, 74)
    ];

    private DispatcherQueueTimer? _animationTimer;
    private Polyline? _waveGlow;
    private Polyline? _waveLine;
    private Ellipse? _coreAura;
    private OverlayWindow? _overlayWindow;
    private VisualMode _mode = VisualMode.Core;
    private int _stateIndex = 1;
    private double _automaticStateDeadline = -1;

    public MainPage()
    {
        App.WriteBootLog("MainPage InitializeComponent begin");
        InitializeComponent();
        App.WriteBootLog("MainPage InitializeComponent end");
    }

    private void Page_Loaded(object sender, RoutedEventArgs e)
    {
        App.WriteBootLog("MainPage Loaded begin");
        BuildCoreVisual();
        App.WriteBootLog("Core visual built");
        BuildWaveform();
        BuildTopology();
        App.WriteBootLog("Waveform and topology built");
        SetMode(VisualMode.Core);
        ApplyState();

        _uptime.Restart();
        _animationTimer = DispatcherQueue.CreateTimer();
        _animationTimer.Interval = TimeSpan.FromMilliseconds(33);
        _animationTimer.Tick += AnimationTimer_Tick;
        _animationTimer.Start();
        UpdateVisuals(0);
        App.WriteBootLog("MainPage Loaded complete");

        if (Environment.GetCommandLineArgs().Any(argument =>
                string.Equals(argument, "--qa-capture", StringComparison.OrdinalIgnoreCase)))
        {
            _ = RunQaCaptureAsync();
        }
    }

    private void Page_Unloaded(object sender, RoutedEventArgs e)
    {
        _animationTimer?.Stop();
        _animationTimer = null;
        _overlayWindow?.Close();
        _overlayWindow = null;
    }

    private void BuildCoreVisual()
    {
        CoreCanvas.Children.Clear();
        _coreContours.Clear();
        _ringRotations.Clear();
        _particles.Clear();

        const double center = 310;

        for (var i = 0; i < 3; i++)
        {
            var size = 536 - (i * 54);
            var ring = new Ellipse
            {
                Width = size,
                Height = size * (0.72 + (i * 0.07)),
                Stroke = Brush((byte)(42 + (i * 18)), 56, 231, 255),
                StrokeThickness = i == 1 ? 2 : 1,
                StrokeDashArray = new DoubleCollection { 10 - i, 5 + i, 2, 7 },
                IsHitTestVisible = false
            };
            var rotation = new RotateTransform
            {
                CenterX = ring.Width / 2,
                CenterY = ring.Height / 2,
                Angle = i * 34
            };
            ring.RenderTransform = rotation;
            Canvas.SetLeft(ring, center - ring.Width / 2);
            Canvas.SetTop(ring, center - ring.Height / 2);
            CoreCanvas.Children.Add(ring);
            _ringRotations.Add(rotation);
        }

        for (var i = 0; i < 6; i++)
        {
            var line = new Line
            {
                X1 = center,
                Y1 = 43 + (i * 7),
                X2 = center,
                Y2 = 70 + (i * 7),
                Stroke = Brush(65, 56, 231, 255),
                StrokeThickness = 1
            };
            line.RenderTransform = new RotateTransform { CenterX = center, CenterY = center, Angle = i * 60 };
            CoreCanvas.Children.Add(line);
        }

        _coreAura = new Ellipse
        {
            Width = 238,
            Height = 238,
            Fill = new LinearGradientBrush
            {
                StartPoint = new Point(0, 0),
                EndPoint = new Point(1, 1),
                GradientStops =
                {
                    new GradientStop { Color = Color.FromArgb(205, 20, 116, 183), Offset = 0 },
                    new GradientStop { Color = Color.FromArgb(170, 13, 54, 118), Offset = 0.48 },
                    new GradientStop { Color = Color.FromArgb(235, 17, 220, 243), Offset = 1 }
                }
            },
            Opacity = 0.32,
            IsHitTestVisible = false
        };
        Canvas.SetLeft(_coreAura, center - 119);
        Canvas.SetTop(_coreAura, center - 119);
        CoreCanvas.Children.Add(_coreAura);

        for (var i = 0; i < 9; i++)
        {
            var contour = new Polyline
            {
                Stroke = Brush((byte)(48 + (i * 16)), (byte)(32 + i * 3), (byte)(126 + i * 12), 255),
                StrokeThickness = i is 0 or 8 ? 2.3 : 1.2,
                IsHitTestVisible = false
            };
            _coreContours.Add(contour);
            CoreCanvas.Children.Add(contour);
        }

        for (var i = 0; i < 18; i++)
        {
            var particle = new Ellipse
            {
                Width = 2 + (i % 3),
                Height = 2 + (i % 3),
                Fill = Brush((byte)(105 + (i % 4) * 32), 56, 231, 255),
                IsHitTestVisible = false
            };
            _particles.Add(particle);
            CoreCanvas.Children.Add(particle);
        }

        var centerDot = new Ellipse
        {
            Width = 26,
            Height = 26,
            Fill = Brush(225, 194, 250, 255),
            Stroke = Brush(255, 56, 231, 255),
            StrokeThickness = 2
        };
        Canvas.SetLeft(centerDot, center - 13);
        Canvas.SetTop(centerDot, center - 13);
        CoreCanvas.Children.Add(centerDot);
    }

    private void BuildWaveform()
    {
        WaveCanvas.Children.Clear();
        _waveGlow = new Polyline
        {
            Stroke = Brush(55, 56, 231, 255),
            StrokeThickness = 8,
            IsHitTestVisible = false
        };
        _waveLine = new Polyline
        {
            Stroke = Brush(245, 91, 240, 255),
            StrokeThickness = 2.4,
            IsHitTestVisible = false
        };
        WaveCanvas.Children.Add(_waveGlow);
        WaveCanvas.Children.Add(_waveLine);
    }

    private void BuildTopology()
    {
        TopologyCanvas.Children.Clear();
        _flowPulses.Clear();

        var nodes = new (Point Position, string Label, bool Alert)[]
        {
            (new Point(45, 242), "INPUT", false),
            (new Point(130, 116), "AUTH", false),
            (new Point(130, 362), "CACHE", false),
            (new Point(240, 242), "CORE", false),
            (new Point(345, 108), "VOICE", false),
            (new Point(345, 242), "SERVICE 07", true),
            (new Point(345, 376), "FILES", false),
            (new Point(430, 242), "OUTPUT", false)
        };
        var links = new (int From, int To)[]
        {
            (0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (3, 5), (3, 6), (4, 7), (5, 7), (6, 7), (1, 5), (2, 5)
        };

        var linkIndex = 0;
        foreach (var (from, to) in links)
        {
            var start = nodes[from].Position;
            var end = nodes[to].Position;
            var alert = nodes[from].Alert || nodes[to].Alert;
            TopologyCanvas.Children.Add(new Line
            {
                X1 = start.X,
                Y1 = start.Y,
                X2 = end.X,
                Y2 = end.Y,
                Stroke = alert ? Brush(105, 255, 184, 74) : Brush(64, 56, 231, 255),
                StrokeThickness = alert ? 1.6 : 1,
                StrokeDashArray = alert ? new DoubleCollection { 4, 4 } : null
            });

            if (linkIndex % 2 == 0)
            {
                var pulse = new Ellipse
                {
                    Width = alert ? 9 : 6,
                    Height = alert ? 9 : 6,
                    Fill = alert ? Brush(255, 255, 184, 74) : Brush(230, 56, 231, 255)
                };
                TopologyCanvas.Children.Add(pulse);
                _flowPulses.Add((pulse, start, end, linkIndex * 0.13));
            }
            linkIndex++;
        }

        foreach (var node in nodes)
        {
            var marker = new Border
            {
                Width = node.Alert ? 102 : 82,
                Height = 40,
                CornerRadius = new CornerRadius(8),
                Background = node.Alert ? Brush(38, 255, 184, 74) : Brush(205, 8, 27, 42),
                BorderBrush = node.Alert ? Brush(220, 255, 184, 74) : Brush(150, 56, 231, 255),
                BorderThickness = new Thickness(node.Alert ? 2 : 1),
                Child = new TextBlock
                {
                    Text = node.Label,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = node.Alert ? Brush(255, 255, 216, 151) : Brush(255, 214, 245, 255),
                    FontFamily = new FontFamily("Consolas"),
                    FontSize = 10
                }
            };
            Canvas.SetLeft(marker, node.Position.X - marker.Width / 2);
            Canvas.SetTop(marker, node.Position.Y - marker.Height / 2);
            TopologyCanvas.Children.Add(marker);
        }
    }

    private void AnimationTimer_Tick(DispatcherQueueTimer sender, object args)
    {
        var t = _uptime.Elapsed.TotalSeconds;
        UpdateVisuals(t);

        if (_automaticStateDeadline > 0 && t >= _automaticStateDeadline)
        {
            _automaticStateDeadline = -1;
            _stateIndex = 4;
            ApplyState();
        }
    }

    private void UpdateVisuals(double t)
    {
        ClockText.Text = DateTime.Now.ToString("HH:mm:ss");
        DateText.Text = DateTime.Now.ToString("ddd / dd MMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant();
        UptimeText.Text = _uptime.Elapsed.ToString(@"hh\:mm\:ss");

        var cpu = 24 + 11 * Math.Sin(t * 0.62) + 4 * Math.Sin(t * 1.71);
        var memory = 41 + 3 * Math.Sin(t * 0.18 + 0.6);
        var network = 18 + 13 * (0.5 + 0.5 * Math.Sin(t * 0.9 + 1.2));
        CpuBar.Value = cpu;
        MemoryBar.Value = memory;
        NetworkBar.Value = Math.Min(100, network * 2.1);
        CpuText.Text = $"{cpu:0}%";
        MemoryText.Text = $"{memory:0}%";
        NetworkText.Text = $"{network:0} Mbps";
        SignalDbText.Text = $"{-20 + 5 * Math.Sin(t * 2.2):0} dB";
        PipelinePulse.Opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.Sin(t * 4));
        ObjectiveProgress.Width = 150 + 28 * (0.5 + 0.5 * Math.Sin(t * 0.45));

        if (_coreAura is not null)
        {
            _coreAura.Opacity = 0.24 + 0.14 * (0.5 + 0.5 * Math.Sin(t * 2.3));
            var scale = 0.96 + 0.06 * (0.5 + 0.5 * Math.Sin(t * 1.7));
            _coreAura.RenderTransform = new ScaleTransform { ScaleX = scale, ScaleY = scale, CenterX = 119, CenterY = 119 };
        }

        for (var i = 0; i < _ringRotations.Count; i++)
        {
            _ringRotations[i].Angle = (i % 2 == 0 ? 1 : -1) * (t * (5 + i * 2) + i * 37);
        }

        const double center = 310;
        for (var layer = 0; layer < _coreContours.Count; layer++)
        {
            var points = new PointCollection();
            var baseRadius = 70 + layer * 11.5;
            for (var degrees = 0; degrees <= 360; degrees += 3)
            {
                var angle = degrees * Math.PI / 180.0;
                var wave =
                    8.5 * Math.Sin(angle * 3 + t * 0.85 + layer * 0.48) +
                    5.2 * Math.Sin(angle * 7 - t * 1.15 + layer) +
                    2.8 * Math.Cos(angle * 11 + t * 1.7 - layer * 0.3);
                var breathing = 3.5 * Math.Sin(t * 1.4 + layer * 0.37);
                var radius = baseRadius + wave + breathing;
                var depth = 0.91 + 0.06 * Math.Sin(angle * 2 + t * 0.34 + layer * 0.2);
                points.Add(new Point(
                    center + Math.Cos(angle) * radius,
                    center + Math.Sin(angle) * radius * depth));
            }
            _coreContours[layer].Points = points;
        }

        for (var i = 0; i < _particles.Count; i++)
        {
            var angle = t * (0.18 + (i % 5) * 0.035) + i * 2.399;
            var radius = 182 + (i % 4) * 28 + 10 * Math.Sin(t * 0.7 + i);
            var x = center + Math.Cos(angle) * radius;
            var y = center + Math.Sin(angle) * radius * 0.68;
            Canvas.SetLeft(_particles[i], x - _particles[i].Width / 2);
            Canvas.SetTop(_particles[i], y - _particles[i].Height / 2);
            _particles[i].Opacity = 0.28 + 0.72 * (0.5 + 0.5 * Math.Sin(t * 2 + i));
        }

        UpdateWaveform(t);
        foreach (var route in _flowPulses)
        {
            var phase = (t * 0.24 + route.Offset) % 1.0;
            var x = route.Start.X + (route.End.X - route.Start.X) * phase;
            var y = route.Start.Y + (route.End.Y - route.Start.Y) * phase;
            Canvas.SetLeft(route.Pulse, x - route.Pulse.Width / 2);
            Canvas.SetTop(route.Pulse, y - route.Pulse.Height / 2);
            route.Pulse.Opacity = 0.35 + 0.65 * Math.Sin(phase * Math.PI);
        }
    }

    private void UpdateWaveform(double t)
    {
        if (_waveLine is null || _waveGlow is null)
        {
            return;
        }

        var width = Math.Max(220, WaveCanvas.ActualWidth);
        const double centerY = 39;
        var points = new PointCollection();
        var glowPoints = new PointCollection();
        for (var x = 0.0; x <= width; x += 3)
        {
            var envelope = Math.Pow(Math.Sin(Math.PI * x / width), 0.7);
            var signal = Math.Sin(x * 0.16 + t * 5.4) + 0.55 * Math.Sin(x * 0.39 - t * 7.1) + 0.22 * Math.Sin(x * 0.73 + t * 3.6);
            var stateGain = _stateIndex == 0 ? 0.18 : _stateIndex == 2 ? 0.72 : 1.0;
            var point = new Point(x, centerY + signal * envelope * 17 * stateGain);
            points.Add(point);
            glowPoints.Add(point);
        }
        _waveLine.Points = points;
        _waveGlow.Points = glowPoints;
    }

    private void SetMode(VisualMode mode)
    {
        _mode = mode;
        CoreView.Visibility = mode == VisualMode.Core ? Visibility.Visible : Visibility.Collapsed;
        CommandView.Visibility = mode == VisualMode.Command ? Visibility.Visible : Visibility.Collapsed;
        OverlayView.Visibility = mode == VisualMode.Overlay ? Visibility.Visible : Visibility.Collapsed;
        DiagnosticsView.Visibility = mode == VisualMode.Diagnostics ? Visibility.Visible : Visibility.Collapsed;

        var titles = mode switch
        {
            VisualMode.Core => ("ORBITAL CORE", "COGNITIVE SIGNAL / REAL-TIME VISUALIZATION"),
            VisualMode.Command => ("COMMAND DECK", "CONVERSATION / TASKS / TOOLS"),
            VisualMode.Overlay => ("GHOST OVERLAY", "COMPACT / ALWAYS-ON-TOP / LOW INTERRUPTION"),
            _ => ("TACTICAL FOCUS", "SYSTEM DIAGNOSTICS / PERMISSION-GATED ACTIONS")
        };
        ModeTitle.Text = titles.Item1;
        ModeSubtitle.Text = titles.Item2;
        ActiveModeText.Text = mode.ToString().ToUpperInvariant();
        EventTimeText.Text = $"{DateTime.Now:HH:mm:ss} / NAV";
        EventText.Text = $"{titles.Item1} mode activated";

        var buttons = new[] { CoreNavButton, CommandNavButton, OverlayNavButton, DiagnosticsNavButton };
        for (var i = 0; i < buttons.Length; i++)
        {
            var selected = i == (int)mode;
            buttons[i].Background = selected ? Brush(52, 25, 112, 142) : Brush(25, 29, 91, 114);
            buttons[i].BorderBrush = selected ? Brush(190, 56, 231, 255) : Brush(52, 56, 231, 255);
        }
    }

    private void ApplyState()
    {
        var state = _states[_stateIndex];
        var color = _stateColors[_stateIndex];
        StateButton.Content = state;
        StateButton.Foreground = new SolidColorBrush(color);
        StateButton.BorderBrush = new SolidColorBrush(Color.FromArgb(170, color.R, color.G, color.B));
        StateButton.Background = new SolidColorBrush(Color.FromArgb(32, color.R, color.G, color.B));
        CoreStateText.Text = state;
        CoreStateText.Foreground = new SolidColorBrush(color);
        CorePhaseText.Text = $"COGNITIVE PHASE {_stateIndex + 1:00}";
        SignalStatusText.Text = $"{state} / CHANNEL 01";
        EventTimeText.Text = $"{DateTime.Now:HH:mm:ss} / STATE";
        EventText.Text = $"Cognitive state changed to {state}";
    }

    private void CycleState()
    {
        _stateIndex = (_stateIndex + 1) % _states.Length;
        _automaticStateDeadline = -1;
        ApplyState();
    }

    private void SubmitCommand()
    {
        var command = CommandInput.Text.Trim();
        if (command.Length == 0)
        {
            CommandInput.PlaceholderText = "Enter a command before sending.";
            return;
        }

        SetMode(VisualMode.Command);
        AssistantResponseText.Text = $"Local visual command received: “{command}”. This prototype demonstrates interface feedback only; no AI request or system action was performed.";
        CommandInput.Text = string.Empty;
        _stateIndex = 3;
        _automaticStateDeadline = _uptime.Elapsed.TotalSeconds + 1.8;
        ApplyState();
    }

    private void CoreNav_Click(object sender, RoutedEventArgs e) => SetMode(VisualMode.Core);
    private void CommandNav_Click(object sender, RoutedEventArgs e) => SetMode(VisualMode.Command);
    private void OverlayNav_Click(object sender, RoutedEventArgs e) => SetMode(VisualMode.Overlay);
    private void DiagnosticsNav_Click(object sender, RoutedEventArgs e) => SetMode(VisualMode.Diagnostics);
    private void StateButton_Click(object sender, RoutedEventArgs e) => CycleState();
    private void SendCommand_Click(object sender, RoutedEventArgs e) => SubmitCommand();

    private void CommandInput_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter)
        {
            e.Handled = true;
            SubmitCommand();
        }
    }

    private void LaunchOverlay_Click(object sender, RoutedEventArgs e)
    {
        if (_overlayWindow is null)
        {
            _overlayWindow = new OverlayWindow();
            _overlayWindow.Closed += (_, _) => _overlayWindow = null;
        }
        _overlayWindow.Activate();
        EventTimeText.Text = $"{DateTime.Now:HH:mm:ss} / OVERLAY";
        EventText.Text = "Always-on-top overlay launched";
    }

    private void ReviewAction_Click(object sender, RoutedEventArgs e)
    {
        ReviewResultText.Text = "Review complete: simulation only. Explicit approval would be required before any real system action.";
        EventTimeText.Text = $"{DateTime.Now:HH:mm:ss} / SAFETY";
        EventText.Text = "Permission gate blocked automatic change";
    }

    private async Task RunQaCaptureAsync()
    {
        try
        {
            var outputDirectory = Environment.GetEnvironmentVariable("JARVIS_QA_OUTPUT");
            if (string.IsNullOrWhiteSpace(outputDirectory))
            {
                outputDirectory = System.IO.Path.Combine(AppContext.BaseDirectory, "qa-captures");
            }
            Directory.CreateDirectory(outputDirectory);
            App.WriteBootLog($"QA capture begin: {outputDirectory}");

            await Task.Delay(900);
            var captures = new (VisualMode Mode, string FileName)[]
            {
                (VisualMode.Core, "01_ORBITAL_CORE.png"),
                (VisualMode.Command, "02_COMMAND_DECK.png"),
                (VisualMode.Overlay, "03_GHOST_OVERLAY.png"),
                (VisualMode.Diagnostics, "04_TACTICAL_FOCUS.png")
            };

            foreach (var capture in captures)
            {
                SetMode(capture.Mode);
                var expectedViewVisible = capture.Mode switch
                {
                    VisualMode.Core => CoreView.Visibility == Visibility.Visible,
                    VisualMode.Command => CommandView.Visibility == Visibility.Visible,
                    VisualMode.Overlay => OverlayView.Visibility == Visibility.Visible,
                    VisualMode.Diagnostics => DiagnosticsView.Visibility == Visibility.Visible,
                    _ => false
                };
                if (!expectedViewVisible || ActiveModeText.Text != capture.Mode.ToString().ToUpperInvariant())
                {
                    throw new InvalidOperationException($"Navigation self-test failed for {capture.Mode}.");
                }
                await Task.Delay(550);
                await CaptureElementAsync(RootShell, System.IO.Path.Combine(outputDirectory, capture.FileName));
                App.WriteBootLog($"QA captured: {capture.FileName}");
            }

            var previousState = _stateIndex;
            CycleState();
            if (_stateIndex == previousState || !Equals(StateButton.Content, _states[_stateIndex]))
            {
                throw new InvalidOperationException("State-cycle self-test failed.");
            }

            CommandInput.Text = "QA prototype status";
            SubmitCommand();
            if (!AssistantResponseText.Text.Contains("QA prototype status", StringComparison.Ordinal) ||
                CommandView.Visibility != Visibility.Visible)
            {
                throw new InvalidOperationException("Command-entry self-test failed.");
            }

            var overlay = new OverlayWindow();
            overlay.Activate();
            await Task.Delay(650);
            if (overlay.Content is FrameworkElement overlayRoot)
            {
                await CaptureElementAsync(overlayRoot, System.IO.Path.Combine(outputDirectory, "05_LIVE_OVERLAY_WINDOW.png"));
                App.WriteBootLog("QA captured: 05_LIVE_OVERLAY_WINDOW.png");
            }
            overlay.Close();

            var manifest = new[]
            {
                $"completed={DateTime.Now:O}",
                $"runtime={Environment.Version}",
                $"os={Environment.OSVersion}",
                "modes=ORBITAL_CORE,COMMAND_DECK,GHOST_OVERLAY,TACTICAL_FOCUS,LIVE_OVERLAY_WINDOW",
                "navigation_check=passed",
                "state_cycle_check=passed",
                "command_entry_check=passed",
                "overlay_window_check=passed",
                "data_source=SIMULATED",
                "external_ai_connected=false",
                "system_actions_applied=false"
            };
            File.WriteAllLines(System.IO.Path.Combine(outputDirectory, "qa-capture-complete.txt"), manifest);
            App.WriteBootLog("QA capture complete");
            Application.Current.Exit();
        }
        catch (Exception exception)
        {
            App.WriteBootLog("QA capture failed", exception);
            Application.Current.Exit();
        }
    }

    private static async Task CaptureElementAsync(FrameworkElement element, string filePath)
    {
        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(element);
        if (bitmap.PixelWidth <= 0 || bitmap.PixelHeight <= 0)
        {
            throw new InvalidOperationException("RenderTargetBitmap returned an empty image.");
        }

        var pixelBuffer = await bitmap.GetPixelsAsync();
        var pixels = new byte[pixelBuffer.Length];
        using (var reader = DataReader.FromBuffer(pixelBuffer))
        {
            reader.ReadBytes(pixels);
        }

        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(filePath)!);
        using (File.Create(filePath))
        {
        }
        var storageFile = await StorageFile.GetFileFromPathAsync(filePath);
        using var stream = await storageFile.OpenAsync(FileAccessMode.ReadWrite);
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied,
            (uint)bitmap.PixelWidth,
            (uint)bitmap.PixelHeight,
            96,
            96,
            pixels);
        await encoder.FlushAsync();
    }

    private static SolidColorBrush Brush(byte alpha, byte red, byte green, byte blue) =>
        new(Color.FromArgb(alpha, red, green, blue));
}
