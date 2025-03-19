import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

// Helper function to extract error messages
const errorString = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// Activation function for the extension
export function activate(context: vscode.ExtensionContext) {
  console.log("PackageRadar is now active");

  // Register command to analyze current file
  let analyzeCurrentFileCommand = vscode.commands.registerCommand(
    "packageRadar.analyzeCurrentFile",
    async () => {
      try {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showInformationMessage("No active file to analyze");
          return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        const fileExtension = path.extname(filePath);

        // Check if current file is JS/TS
        if (![".js", ".jsx", ".ts", ".tsx"].includes(fileExtension)) {
          vscode.window.showInformationMessage(
            "Current file is not a JavaScript or TypeScript file"
          );
          return;
        }

        // Show progress indicator
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing current file...",
            cancellable: true,
          },
          async (progress) => {
            progress.report({ message: "Scanning imports..." });

            // Analyze current file
            const imports = analyzeFileImports(filePath);

            if (imports.length === 0) {
              vscode.window.showInformationMessage(
                "No npm packages found in the current file"
              );
              return;
            }

            progress.report({
              message: "Fetching npm metadata...",
              increment: 50,
            });

            // Fetch npm metadata for packages
            const packageData = await fetchNpmMetadata(imports);

            progress.report({
              message: "Generating recommendations...",
              increment: 40,
            });

            // Create simple analysis structure
            const packageImports: Record<string, string[]> = {};
            packageImports[filePath] = imports;

            const analysis = {
              structure: [],
              packageImports,
              suggestedAnalysis: [filePath],
            };

            // Display results
            displayPackageAnalysis(analysis, packageData, context.extensionUri);

            progress.report({ message: "Analysis complete", increment: 10 });
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error analyzing current file: ${errorString(error)}`
        );
      }
    }
  );

  // Register command to analyze project structure
  let analyzeProjectCommand = vscode.commands.registerCommand(
    "packageRadar.analyzeProject",
    async (selectedResource) => {
      try {
        if (!selectedResource) {
          // If no folder is selected, try to use current workspace folder
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage("Please select a folder to analyze");
            return;
          }
          selectedResource = { fsPath: workspaceFolders[0].uri.fsPath };
        }

        const targetPath = selectedResource.fsPath;

        // Show progress indicator
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing project packages...",
            cancellable: true,
          },
          async (progress) => {
            progress.report({ message: "Scanning project structure..." });

            // Analyze project structure
            const analysis = analyzeProjectStructure(targetPath);

            progress.report({
              message: "Extracting package dependencies...",
              increment: 30,
            });

            // Extract unique packages
            const uniquePackages = extractUniquePackages(
              analysis.packageImports
            );

            if (uniquePackages.size === 0) {
              vscode.window.showInformationMessage(
                "No npm packages found in the project"
              );
              return;
            }

            progress.report({
              message: "Fetching npm metadata...",
              increment: 30,
            });

            // Fetch npm metadata for packages
            const packageData = await fetchNpmMetadata(
              Array.from(uniquePackages)
            );

            progress.report({
              message: "Generating recommendations...",
              increment: 30,
            });

            // Create webview to display results
            displayPackageAnalysis(analysis, packageData, context.extensionUri);

            progress.report({ message: "Analysis complete", increment: 10 });
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error analyzing project: ${errorString(error)}`
        );
      }
    }
  );

  // Register command to analyze selected files
  let analyzeSelectedFilesCommand = vscode.commands.registerCommand(
    "packageRadar.analyzeSelectedFiles",
    async () => {
      try {
        // Get all JS/TS files in the workspace
        const files = await vscode.workspace.findFiles(
          "**/*.{js,ts,jsx,tsx}",
          "**/node_modules/**"
        );

        if (files.length === 0) {
          vscode.window.showInformationMessage(
            "No JavaScript/TypeScript files found in workspace"
          );
          return;
        }

        // Let user select files to analyze
        const selectedFiles = await vscode.window.showQuickPick(
          files.map((file) => ({
            label: path.basename(file.fsPath),
            description: vscode.workspace.asRelativePath(file.fsPath),
            path: file.fsPath,
          })),
          {
            canPickMany: true,
            placeHolder: "Select files to analyze for package recommendations",
          }
        );

        if (!selectedFiles || selectedFiles.length === 0) {
          return;
        }

        // Show progress indicator
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing selected files...",
            cancellable: true,
          },
          async (progress) => {
            progress.report({ message: "Scanning imports..." });

            // Analyze selected files
            const packageImports: Record<string, string[]> = {};
            selectedFiles.forEach((file) => {
              const imports = analyzeFileImports(file.path);
              if (imports.length > 0) {
                packageImports[file.path] = imports;
              }
            });

            // Extract unique packages
            const uniquePackages = extractUniquePackages(packageImports);

            if (uniquePackages.size === 0) {
              vscode.window.showInformationMessage(
                "No npm packages found in selected files"
              );
              return;
            }

            progress.report({
              message: "Fetching npm metadata...",
              increment: 50,
            });

            // Fetch npm metadata for packages
            const packageData = await fetchNpmMetadata(
              Array.from(uniquePackages)
            );

            progress.report({
              message: "Generating recommendations...",
              increment: 40,
            });

            // Create analysis result structure
            const analysis = {
              structure: [],
              packageImports,
              suggestedAnalysis: Object.keys(packageImports),
            };

            // Display results
            displayPackageAnalysis(analysis, packageData, context.extensionUri);

            progress.report({ message: "Analysis complete", increment: 10 });
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error analyzing files: ${errorString(error)}`
        );
      }
    }
  );

  context.subscriptions.push(
    analyzeCurrentFileCommand,
    analyzeProjectCommand,
    analyzeSelectedFilesCommand
  );
}

// Function to analyze project structure
function analyzeProjectStructure(targetPath: string, depth: number = 0) {
  interface ProjectAnalysis {
    structure: {
      type: "directory" | "file";
      name: string;
      path: string;
      children?: ProjectAnalysis["structure"];
    }[];
    packageImports: Record<string, string[]>;
    suggestedAnalysis: string[];
  }

  let analysisResult: ProjectAnalysis = {
    structure: [],
    packageImports: {},
    suggestedAnalysis: [],
  };

  if (!fs.existsSync(targetPath)) {
    return analysisResult;
  }

  // Sort directories first, then files
  let allEntries = fs.readdirSync(targetPath);
  let directories: string[] = [];
  let files: string[] = [];

  allEntries.forEach((entry) => {
    let fullPath = path.join(targetPath, entry);
    try {
      if (fs.statSync(fullPath).isDirectory()) {
        // Skip node_modules and other non-relevant directories
        if (
          entry !== "node_modules" &&
          entry !== ".git" &&
          !entry.startsWith(".")
        ) {
          directories.push(entry);
        }
      } else {
        // Focus on JS/TS files for analysis
        if (
          entry.endsWith(".js") ||
          entry.endsWith(".jsx") ||
          entry.endsWith(".ts") ||
          entry.endsWith(".tsx")
        ) {
          files.push(entry);
        }
      }
    } catch (error) {
      // Skip files that can't be accessed
      console.warn(`Unable to access ${fullPath}: ${errorString(error)}`);
    }
  });

  // Process all directories
  directories.forEach((dir: string) => {
    let fullPath: string = path.join(targetPath, dir);
    let subAnalysis: ProjectAnalysis = analyzeProjectStructure(
      fullPath,
      depth + 1
    );
    analysisResult.structure.push({
      type: "directory",
      name: dir,
      path: fullPath,
      children: subAnalysis.structure,
    });

    // Merge package imports from subdirectories
    Object.assign(analysisResult.packageImports, subAnalysis.packageImports);

    // Add suggested files from subdirectories
    analysisResult.suggestedAnalysis = [
      ...analysisResult.suggestedAnalysis,
      ...subAnalysis.suggestedAnalysis,
    ];
  });

  // Process all files
  files.forEach((file) => {
    let fullPath = path.join(targetPath, file);
    analysisResult.structure.push({
      type: "file",
      name: file,
      path: fullPath,
    });

    // Analyze imports for JS/TS files
    try {
      const imports = analyzeFileImports(fullPath);
      if (imports.length > 0) {
        analysisResult.packageImports[fullPath] = imports;

        // If file has many imports, suggest it for detailed analysis
        if (imports.length > 3) {
          analysisResult.suggestedAnalysis.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(
        `Error analyzing imports in ${fullPath}: ${errorString(error)}`
      );
    }
  });

  return analysisResult;
}

// Function to analyze imports in a file
function analyzeFileImports(filePath: string): string[] {
  // Basic implementation - uses regex to extract imports
  const content = fs.readFileSync(filePath, "utf8");
  const imports = new Set<string>();

  try {
    // Detect require statements
    const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g);
    if (requireMatches) {
      requireMatches.forEach((match) => {
        const regexResult = /require\(['"]([^'"]+)['"]\)/.exec(match);
        if (regexResult && regexResult[1]) {
          const pkg = regexResult[1];
          // Only include npm packages (not relative paths)
          if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
            // Extract base package name (e.g., 'lodash/fp' -> 'lodash')
            const baseName = pkg.split("/")[0];
            imports.add(baseName);
          }
        }
      });
    }

    // Detect import statements
    const importMatches = content.match(/import .+ from ['"]([^'"]+)['"]/g);
    if (importMatches) {
      importMatches.forEach((match) => {
        const regexResult = /from ['"]([^'"]+)['"]/g.exec(match);
        if (regexResult && regexResult[1]) {
          const pkg = regexResult[1];
          // Only include npm packages (not relative paths)
          if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
            // Extract base package name
            const baseName = pkg.split("/")[0];
            imports.add(baseName);
          }
        }
      });
    }

    // Detect dynamic imports
    const dynamicImportMatches = content.match(/import\(['"]([^'"]+)['"]\)/g);
    if (dynamicImportMatches) {
      dynamicImportMatches.forEach((match) => {
        const regexResult = /import\(['"]([^'"]+)['"]\)/.exec(match);
        if (regexResult && regexResult[1]) {
          const pkg = regexResult[1];
          // Only include npm packages (not relative paths)
          if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
            // Extract base package name
            const baseName = pkg.split("/")[0];
            imports.add(baseName);
          }
        }
      });
    }
  } catch (error) {
    console.error(
      `Error parsing imports in ${filePath}: ${errorString(error)}`
    );
  }

  return Array.from(imports);
}

// Function to extract unique packages from an import analysis
function extractUniquePackages(
  packageImports: Record<string, string[]>
): Set<string> {
  const uniquePackages = new Set<string>();
  Object.values(packageImports).forEach((imports) => {
    imports.forEach((pkg) => uniquePackages.add(pkg));
  });
  return uniquePackages;
}

// Function to fetch npm metadata for a list of packages
async function fetchNpmMetadata(
  packageNames: string[]
): Promise<Record<string, any>> {
  const packageData: Record<string, any> = {};

  await Promise.all(
    packageNames.map(async (packageName) => {
      try {
        // Fetch basic package info from npm registry
        const response = await axios.get(
          `https://registry.npmjs.org/${packageName}`
        );

        if (response.status === 200) {
          const data = response.data;
          const latestVersion = data["dist-tags"]?.latest;

          packageData[packageName] = {
            name: packageName,
            description: data.description || "",
            version: latestVersion || "",
            license: data.license || "Unknown",
            homepage: data.homepage || "",
            repository: data.repository?.url || "",
            maintainers: data.maintainers?.length || 0,
            lastPublished: data.time?.[latestVersion] || "",
            dependencies: data.versions?.[latestVersion]?.dependencies || {},
            weeklyDownloads: 0, // Will be populated with additional API call
            alternatives: [], // Will be populated later with recommendations
          };

          // Additional API call to get download counts
          try {
            const downloadsResponse = await axios.get(
              `https://api.npmjs.org/downloads/point/last-week/${packageName}`
            );
            if (downloadsResponse.status === 200) {
              packageData[packageName].weeklyDownloads =
                downloadsResponse.data.downloads || 0;
            }
          } catch (error) {
            console.warn(`Could not fetch download stats for ${packageName}`);
          }
        }
      } catch (error) {
        console.warn(
          `Error fetching metadata for ${packageName}: ${errorString(error)}`
        );
        // Store minimal info for packages that couldn't be fetched
        packageData[packageName] = {
          name: packageName,
          description: "Could not fetch package data",
          version: "",
          error: errorString(error),
        };
      }
    })
  );

  // Generate simple recommendations based on package popularity
  // In a real implementation, this would use more sophisticated AI analysis
  Object.keys(packageData).forEach((packageName) => {
    // Placeholder for future AI-based recommendations
    // For now, just add some common alternatives for demonstration
    if (packageName === "moment") {
      packageData[packageName].alternatives = ["date-fns", "dayjs", "luxon"];
    } else if (packageName === "lodash" || packageName === "underscore") {
      packageData[packageName].alternatives = ["lodash-es", "ramda"];
    } else if (packageName === "request") {
      packageData[packageName].alternatives = ["axios", "node-fetch", "got"];
    } else if (packageName === "jquery") {
      packageData[packageName].alternatives = ["cash-dom", "umbrella"];
    } else {
      // For packages without predefined alternatives, leave empty for now
      // This is where AI recommendations would come in
      packageData[packageName].alternatives = [];
    }
  });

  return packageData;
}

// Function to display package analysis in a webview
function displayPackageAnalysis(
  analysis: any,
  packageData: any,
  extensionUri: vscode.Uri
): void {
  // Create webview panel
  const panel = vscode.window.createWebviewPanel(
    "packageRadar",
    "PackageRadar Analysis",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    }
  );

  // Generate HTML content
  panel.webview.html = generateAnalysisHTML(analysis, packageData);

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(
    (message) => {
      if (message.command === "openFile") {
        const filePath = message.filepath;
        if (fs.existsSync(filePath)) {
          vscode.workspace.openTextDocument(filePath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        }
      }
    },
    undefined,
    []
  );
}

// Function to generate HTML for the analysis webview
function generateAnalysisHTML(analysis: any, packageData: any): string {
  // Count total imports per package
  const packageUsage: Record<string, { count: number; files: string[] }> = {};
  Object.entries(analysis.packageImports).forEach(
    ([file, imports]: [string, any]) => {
      imports.forEach((pkg: string) => {
        if (!packageUsage[pkg]) {
          packageUsage[pkg] = {
            count: 0,
            files: [],
          };
        }
        packageUsage[pkg].count++;
        packageUsage[pkg].files.push(file);
      });
    }
  );

  // Sort packages by usage count
  const sortedPackages = Object.keys(packageUsage).sort(
    (a, b) => packageUsage[b].count - packageUsage[a].count
  );

  // Generate package cards HTML
  const packageCardsHTML = sortedPackages
    .map((pkg) => {
      const pkgData = packageData[pkg] || {
        name: pkg,
        description: "No metadata available",
        version: "Unknown",
        weeklyDownloads: "Unknown",
      };

      const filesHTML = packageUsage[pkg].files
        .map(
          (file) => `
            <div class="file-item">
              <button class="file-link" onclick="openFile('${file.replace(
                /\\/g,
                "\\\\"
              )}')">
                ${path.basename(file)}
              </button>
              <span class="file-path">${file}</span>
            </div>
          `
        )
        .join("");

      const alternativesHTML = pkgData.alternatives?.length
        ? pkgData.alternatives
            .map(
              (alt: string) => `
                <div class="alternative-item">
                  <span class="alternative-name">${alt}</span>
                  <a href="https://www.npmjs.com/package/${alt}" target="_blank" class="alternative-link">
                    View on npm
                  </a>
                </div>
              `
            )
            .join("")
        : '<div class="no-alternatives">No alternatives suggested</div>';

      return `
        <div class="package-card">
          <div class="package-header">
            <h3 class="package-name">${pkgData.name}</h3>
            <span class="package-version">v${
              pkgData.version || "Unknown"
            }</span>
          </div>
          <p class="package-description">${
            pkgData.description || "No description available"
          }</p>
          <div class="package-stats">
            <div class="stat">
              <span class="stat-label">Weekly Downloads:</span>
              <span class="stat-value">${
                typeof pkgData.weeklyDownloads === "number"
                  ? pkgData.weeklyDownloads.toLocaleString()
                  : "Unknown"
              }</span>
            </div>
            <div class="stat">
              <span class="stat-label">Used in:</span>
              <span class="stat-value">${packageUsage[pkg].count} file${
        packageUsage[pkg].count === 1 ? "" : "s"
      }</span>
            </div>
          </div>

          <div class="package-section">
            <h4 class="section-title">Files Using This Package</h4>
            <div class="file-list">
              ${filesHTML}
            </div>
          </div>

          <div class="package-section">
            <h4 class="section-title">Suggested Alternatives</h4>
            <div class="alternatives-list">
              ${alternativesHTML}
            </div>
          </div>

          <div class="package-links">
            <a href="https://www.npmjs.com/package/${pkg}" target="_blank" class="npm-link">
              View on npm
            </a>
            ${
              pkgData.homepage
                ? `<a href="${pkgData.homepage}" target="_blank" class="homepage-link">
                   Homepage
                 </a>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PackageRadar Analysis</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          padding: 20px;
          line-height: 1.5;
          color: var(--vscode-editor-foreground);
        }

        h1, h2, h3, h4 {
          color: var(--vscode-editor-foreground);
        }

        .header {
          display: flex;
          align-items: center;
          margin-bottom: 20px;
        }

        .logo {
          width: 30px;
          height: 30px;
          margin-right: 10px;
        }

        .summary {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }

        .package-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }

        .package-card {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 15px;
          background-color: var(--vscode-editor-background);
        }

        .package-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .package-name {
          margin: 0;
          color: var(--vscode-symbolIcon-packageForeground);
        }

        .package-version {
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
        }

        .package-description {
          margin-top: 0;
          margin-bottom: 15px;
          color: var(--vscode-descriptionForeground);
        }

        .package-stats {
          display: flex;
          margin-bottom: 15px;
          gap: 15px;
        }

        .stat {
          display: flex;
          flex-direction: column;
        }

        .stat-label {
          font-size: 0.8em;
          color: var(--vscode-descriptionForeground);
        }

        .stat-value {
          font-weight: bold;
        }

        .package-section {
          margin-top: 15px;
          margin-bottom: 15px;
        }

        .section-title {
          margin-top: 0;
          margin-bottom: 10px;
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
        }

        .file-list {
          max-height: 100px;
          overflow-y: auto;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 2px;
          font-size: 0.9em;
        }

        .file-item {
          padding: 5px;
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          flex-direction: column;
        }

        .file-item:last-child {
          border-bottom: none;
        }

        .file-link {
          color: var(--vscode-textLink-foreground);
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          cursor: pointer;
          text-align: left;
          text-decoration: underline;
        }

        .file-path {
          font-size: 0.8em;
          color: var(--vscode-descriptionForeground);
        }

        .alternatives-list {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 2px;
          font-size: 0.9em;
        }

        .alternative-item {
          padding: 5px;
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .alternative-item:last-child {
          border-bottom: none;
        }

        .alternative-name {
          font-weight: bold;
        }

        .alternative-link {
          color: var(--vscode-textLink-foreground);
          font-size: 0.8em;
        }

        .no-alternatives {
          padding: 5px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }

        .package-links {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }

        .npm-link, .homepage-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          font-size: 0.9em;
        }

        .npm-link:hover, .homepage-link:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>PackageRadar Analysis</h1>
      </div>

      <div class="summary">
        <p>Analyzed <strong>${
          Object.keys(analysis.packageImports).length
        }</strong> files containing <strong>${
    sortedPackages.length
  }</strong> unique npm packages.</p>
      </div>

      <div class="package-grid">
        ${packageCardsHTML}
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        function openFile(filepath) {
          vscode.postMessage({
            command: 'openFile',
            filepath: filepath
          });
        }
      </script>
    </body>
    </html>
  `;
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("PackageRadar is now deactivated");
}
