import { DataSet } from "vis-data";
import { Network } from "vis-network";
import type { GraphUser } from "../graph-scraper/types.js";

// Define the expected structure of the JSON data
interface GithubGraphJson {
  users: GraphUser[];
  edges: Array<{ from: string; to: string }>;
  processedUsernames: string[];
  ignoredUsernames: string[];
  maxDepth: number;
}

// --- Wrap the core logic in an async function ---
async function initializeNetwork() {
  console.log("Initializing network...");

  try {
    // Fetch the JSON data dynamically
    const response = await fetch("/dataOutputs/github-graph.json");
    if (!response.ok) {
      throw new Error(
        `HTTP error! status: ${response.status} - Could not fetch graph data.`
      );
    }
    const graphData = (await response.json()) as GithubGraphJson;

    console.log("Successfully loaded graph data:", graphData);

    // Color scale based on followers
    function getNodeColor(followers: number): string {
      if (followers > 10000) return "#e04141"; // Red
      if (followers > 5000) return "#e09c41"; // Orange
      if (followers > 1000) return "#e0df41"; // Yellow
      if (followers > 100) return "#7be041"; // Light Green
      return "#41e0c9"; // Cyan
    }

    // Node size based on followers
    function getNodeSize(followers: number): number {
      return 10 + Math.log1p(followers) * 5;
    }

    // Create nodes
    const nodes = new DataSet(
      graphData.users.map((user: GraphUser) => ({
        id: user.login,
        label: user.name || user.login,
        value: getNodeSize(user.followers),
        color: getNodeColor(user.followers),
        title: `<b>${user.name || user.login}</b><br>Followers: ${
          user.followers
        }<br>Depth: ${user.depth}<br>${user.bio || ""}`,
        url: user.profileUrl,
        level: user.depth,
      }))
    );

    // Create edges
    const edges = new DataSet(
      graphData.edges.map((edge, index) => ({
        id: `edge-${index}`,
        from: edge.from,
        to: edge.to,
        arrows: "to",
        color: { color: "#cccccc", opacity: 0.5 },
      }))
    );

    // Find the container element
    const container = document.getElementById("network");
    if (!container) {
      throw new Error("Container element #network not found");
    }

    // Configuration options (keep these as they were)
    const options = {
      nodes: {
        shape: "dot",
        borderWidth: 2,
        font: { size: 12, face: "sans", color: "#333" },
        scaling: {},
      },
      edges: {
        width: 0.5,
        smooth: { enabled: true, type: "continuous", roundness: 0.5 },
      },
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 100,
          springConstant: 0.08,
          damping: 0.4,
          avoidOverlap: 0.5,
        },
        stabilization: { iterations: 1000, fit: true },
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        navigationButtons: true,
        keyboard: true,
      },
    };

    // Create the network
    const network = new Network(container, { nodes, edges }, options);

    // Handle clicks on nodes
    network.on("click", function (params) {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = nodes.get(nodeId) as {
          url?: string;
          [key: string]: any;
        } | null;
        if (node && node.url) {
          window.open(node.url, "_blank");
        }
      }
    });

    // Optional: Log when stabilization is done
    network.on("stabilizationIterationsDone", function () {
      console.log("Network stabilization finished.");
      network.fit();
    });

    console.log(
      `Network initialized with ${nodes.length} nodes and ${edges.length} edges.`
    );
  } catch (error) {
    console.error("Failed to initialize network:", error);
    // Optional: Display error to the user in the HTML
    const container = document.getElementById("network");
    if (container) {
      container.innerHTML = `<p style="color: red; padding: 20px;">Error loading network graph: ${error}</p>`;
    }
  }
}

// --- Call the async function to start everything ---
initializeNetwork();
